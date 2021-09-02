
import { Resolvers, ResultDbObject, UserDbObject } from "allotr-graphql-schema-types";
import { MongoDBSingleton } from "../../utils/mongodb-singleton";

export const UserResolvers: Resolvers = {
  Query: {
    results: async (parent, args, context) => {

      const db = await MongoDBSingleton.getInstance().db;
      // Find all results
      const dbOutput = await db.collection<ResultDbObject>('results').find()

      if (dbOutput == null) {
        return [];
      }

      return dbOutput.toArray() || [];
    },
    currentUser: (parent, args, context) => context.user,
    searchUsers: async (parent, args, context) => {
      const db = await MongoDBSingleton.getInstance().db;

      const usersFound = await db.collection<UserDbObject>("users").find(
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
  }
}