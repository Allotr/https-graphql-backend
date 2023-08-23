
import { LocalRole, OperationResult, Resolvers, ResourceDbObject, ResourceNotificationDbObject, TicketStatusCode, User, UserDbObject, UserDeletionResult } from "allotr-graphql-schema-types";
import { ObjectId, ReadConcern, ReadPreference, TransactionOptions, WriteConcern } from "mongodb"
import { NOTIFICATIONS, RESOURCES, USERS } from "../../consts/collections";
import { clearOutQueueDependantTickets, removeUsersInQueue } from "../../utils/resolver-utils";
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
      const { deleteAllFlag, userIdToDelete } = args;
      if (!new ObjectId(userIdToDelete).equals(context?.user?._id ?? "")) {
        return { status: OperationResult.Error }
      }

      const db = await (await context.mongoDBConnection).db;

      const client = await (await context.mongoDBConnection).connection;

      let result: UserDeletionResult = { status: OperationResult.Ok };

      const timestamp = new Date();

      // We must liberate all resources that lock the queue for other users
      // This code is not inside this operation session because it has its own session
      const userResourceList = await db.collection<ResourceDbObject>(RESOURCES).find({
        "tickets.user._id": context.user._id
      }).sort({
        creationDate: 1
      }).toArray();

      for (const resource of userResourceList) {
        try {
          await clearOutQueueDependantTickets(resource, [{ id: userIdToDelete, role: LocalRole.ResourceUser }], context, TicketStatusCode.AwaitingConfirmation, db);
          await clearOutQueueDependantTickets(resource, [{ id: userIdToDelete, role: LocalRole.ResourceUser }], context, TicketStatusCode.Active, db);
          await removeUsersInQueue(resource, [{ id: userIdToDelete, role: LocalRole.ResourceUser }], timestamp, db, context);
        } catch (e) {
          console.log("Some queue dependant resource could not be cleared out");
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
            "tickets.user._id": new ObjectId(userIdToDelete),
          }, {
            $pull: {
              tickets: {
                "user._id": new ObjectId(userIdToDelete)
              }
            } as any
          }, {
            session
          })
          // Delete resources
          await db.collection<ResourceDbObject>(RESOURCES).deleteMany(
            {
              "createdBy._id": new ObjectId(userIdToDelete),
              ...(!deleteAllFlag && {
                $and: [{
                  "tickets.user.role": LocalRole.ResourceUser
                },
                { "tickets.user._id": { $ne: new ObjectId(userIdToDelete) } }]
              })
            }, {
            session
          })

          // Delete notifications
          await db.collection<ResourceNotificationDbObject>(NOTIFICATIONS).deleteMany({
            "user._id": new ObjectId(userIdToDelete ?? "")
          }, { session })

          // Delete user
          await db.collection<UserDbObject>(USERS).deleteOne({ _id: new ObjectId(userIdToDelete) }, { session })

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
      context.logout((_) => {
        // Implement if needed
      });
      return { status: OperationResult.Ok }
    }
  }
}



