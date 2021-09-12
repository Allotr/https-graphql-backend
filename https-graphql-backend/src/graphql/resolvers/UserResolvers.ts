
import { LocalRole, OperationResult, Resolvers, ResourceDbObject, UserDbObject, UserDeletionResult } from "allotr-graphql-schema-types";
import { MongoDBSingleton } from "../../utils/mongodb-singleton";
import { ObjectId, ReadConcern, ReadPreference, TransactionOptions, WriteConcern } from "mongodb"
import { RESOURCES, USERS } from "../../consts/collections";


export const UserResolvers: Resolvers = {
  Query: {
    currentUser: (parent, args, context) => context.user,
    searchUsers: async (parent, args, context) => {
      const db = await MongoDBSingleton.getInstance().db;

      const usersFound = await db.collection<UserDbObject>(USERS).find(
        !args.query ? {} : {
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
    deleteUser: async (parent, args, context) => {
      const { deleteAllFlag, userId } = args;
      if (!new ObjectId(userId).equals(context.user._id)) {
        return { status: OperationResult.Error }
      }
      const db = await MongoDBSingleton.getInstance().db;

      const client = await MongoDBSingleton.getInstance().connection;

      let result: UserDeletionResult = { status: OperationResult.Ok };

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
      return { status: OperationResult.Ok }
    }
  }
}



