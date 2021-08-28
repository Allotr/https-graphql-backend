
import { Resolvers, ResultDbObject, UserDbObject } from "allotr-graphql-schema-types";
import { MongoDBSingleton } from "../../utils/mongodb-singleton";
import { RedisSingleton } from "../../utils/redis-singleton";

export const UserResolvers: Resolvers = {
  Query: {
    results: async () => {

        // TEST REDIS PUBSUB
        RedisSingleton.getInstance().pubsub.publish('something_changed', { newUpdate: { result: "Otra respuesta..." } })

        const db = await MongoDBSingleton.getInstance().db;
        // Find all results
        const dbOutput = await db.collection<ResultDbObject>('results').find()

        if (dbOutput == null) {
            return [];
        }

        return dbOutput.toArray() || [];
    },
    currentUser: (parent, args, context) => context.user
  },
  Subscription: {
    newUpdate: {
      subscribe: () => RedisSingleton.getInstance().pubsub.asyncIterator('something_changed'),
    }
  }
}