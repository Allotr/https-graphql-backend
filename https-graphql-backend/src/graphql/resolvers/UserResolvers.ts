
import { LocalRole, OperationResult, RequestSource, Resolvers, ResourceDbObject, ResourceNotificationDbObject, TicketStatusCode, User, UserDbObject, UserDeletionResult } from "allotr-graphql-schema-types";
import { ObjectId, ReadConcern, ReadPreference, TransactionOptions, WriteConcern } from "mongodb"
import { NOTIFICATIONS, RESOURCES, USERS } from "../../consts/collections";
import { ResourceResolvers } from "./ResourceResolvers";
import { clearOutAwaitingConfirmation, removeUsersInQueue } from "../../utils/resolver-utils";
import express from "express";


export const UserResolvers: Resolvers = {
  Query: {
    currentUser: (parent, args, context: express.Request) => context.user as User,
    searchUsers: async (parent, args, context: express.Request) => {
      const db = await (await context.mongoDBConnection).db;

      const usersFound = await db.collection<UserDbObject>(USERS).find(
        {
          $text: { $search: args.query ?? "" }
        }, {
        projection: {
          _id: 1, username: 1, name: 1, surname: 1
        }
      }).sort({
        name: 1
      }).toArray();

      const userData = usersFound.map(({ _id, username = "", name = "", surname = "" }) => ({
        id: _id?.toHexString(),
        username,
        name,
        surname
      }));

      return userData;
    }
  },
  Mutation: {
    deleteUser: async (parent, args, context: express.Request) => {
      const { deleteAllFlag, userId } = args;
      if (!new ObjectId(userId).equals(context?.user?._id ?? "")) {
        return { status: OperationResult.Error }
      }

      const db = await (await context.mongoDBConnection).db;

      const client = await (await context.mongoDBConnection).connection;

      let result: UserDeletionResult = { status: OperationResult.Ok };

      const timestamp = new Date();

      // We must liberate all resources aquired before deleting the tickets
      // This way we make sure that the queue progresses
      // This code is not inside this operation session because it has its own session
      const activeResourceList = await db.collection<ResourceDbObject>(RESOURCES).find({
        "tickets.user._id": context.user._id,
        "tickets.statuses.statusCode": TicketStatusCode.Active
      }, {
        projection: {
          _id: 1
        }
      }).sort({
        creationDate: 1
      }).toArray();

      for (const resource of activeResourceList) {
        const releaseResourceFunction = (ResourceResolvers as any)?.Mutation?.releaseResource;
        try {
          await releaseResourceFunction?.(undefined, { requestFrom: RequestSource.Resource, resourceId: new ObjectId(resource?._id ?? "").toHexString() ?? "" }, context)
        } catch (e) {
          console.log("Some resource could not be released. Perhaps it was not active");
        }
      }

      const awaitingConfirmationResources = await db.collection<ResourceDbObject>(RESOURCES).find({
        "tickets.user._id": context.user._id,
        "tickets.statuses.statusCode": TicketStatusCode.AwaitingConfirmation
      }, {
        projection: {
          "tickets.$": 1,
          name: 1,
          createdBy: 1,
          description: 1,
          maxActiveTickets: 1,
          lastModificationDate: 1,
          _id: 1,
          creationDate: 1,
          activeUserCount: 1
        }
      }).sort({
        creationDate: 1
      }).toArray();

      for (const resource of awaitingConfirmationResources) {
        await clearOutAwaitingConfirmation(resource, [{ id: userId, role: LocalRole.ResourceUser }], context)
      }

      const queuedResourceList = await db.collection<ResourceDbObject>(RESOURCES).find({
        "tickets.user._id": context.user._id,
        "tickets.statuses.statusCode": TicketStatusCode.Queued
      }).sort({
        creationDate: 1
      }).toArray();

      for (const resource of queuedResourceList) {
        try {
          await removeUsersInQueue(resource, [{ id: userId, role: LocalRole.ResourceUser }], timestamp, 2, db, context);
        } catch (e) {
          console.log("Some resource could not be released. Perhaps it was not queued");
        }
      }

      // Step 1: Start a Client Session
      const session = client.startSession();
      // Step 2: Optional. Define options to use for the transaction
      const transactionOptions: TransactionOptions = {
        readPreference: new ReadPreference(ReadPreference.PRIMARY),
        readConcern: new ReadConcern("local"),
        writeConcern: new WriteConcern("majority")
      };
      // Step 3: Use withTransaction to start a transaction, execute the callback, and commit (or abort on error)
      // Note: The callback for withTransaction MUST be async and/or return a Promise.
      try {
        await session.withTransaction(async () => {
          // Delete tickets
          await db.collection<ResourceDbObject>(RESOURCES).updateMany({
            "tickets.user._id": new ObjectId(userId),
          }, {
            $pull: {
              tickets: {
                "user._id": new ObjectId(userId)
              }
            } as any
          }, {
            session
          })
          // Delete resources
          await db.collection<ResourceDbObject>(RESOURCES).deleteMany(
            {
              "createdBy._id": new ObjectId(userId),
              ...(!deleteAllFlag && {
                $and: [{
                  "tickets.user.role": LocalRole.ResourceUser
                },
                { "tickets.user._id": { $ne: new ObjectId(userId) } }]
              })
            }, {
            session
          })

          // Delete notifications
          await db.collection<ResourceNotificationDbObject>(NOTIFICATIONS).deleteMany({
            "user._id": new ObjectId(userId ?? "")
          })

          // Delete user
          await db.collection<UserDbObject>(USERS).deleteOne({ _id: new ObjectId(userId) }, { session })

          if (result == null) {
            return { status: OperationResult.Error, newObjectId: null };
          }
        }, transactionOptions);
      } finally {
        await session.endSession();
      }
      if (result.status === OperationResult.Error) {
        return result;
      }
      // Close session before it's too late!
      context.logout();
      return { status: OperationResult.Ok }
    }
  }
}



