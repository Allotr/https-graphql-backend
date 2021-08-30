
import { Resolvers, ResultDbObject, UserDbObject } from "allotr-graphql-schema-types";
import { MongoDBSingleton } from "../../utils/mongodb-singleton";
import { RedisSingleton } from "../../utils/redis-singleton";
import { SortDirection } from "mongodb"

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

      const query = !args.query ? {} : {
        $text: { $search: args.query ?? "" }
      };

      const options: any = {
        projection: {
          _id: 1, username: 1, name: 1, surname: 1
        }
      }

      const sort = {
        name: 1 as SortDirection
      }

      const usersFound = await db.collection<UserDbObject>("users").find(query, options).sort(sort).toArray();

      const userData = usersFound.map(({ _id, username = "", name = "", surname = "" }) => ({
        id: _id?.toHexString(),
        username,
        name,
        surname
      }));

      return userData;
    }
  },
  Subscription: {
    newUpdate: {
      subscribe: () => RedisSingleton.getInstance().pubsub.asyncIterator('something_changed'),
    }
  }
}