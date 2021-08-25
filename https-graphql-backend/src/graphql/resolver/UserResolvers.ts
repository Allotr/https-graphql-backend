
import { Resolvers, ResultDbObject } from "allotr-graphql-schema-types";
import { RedisSingleton } from "../../utils/redis-singleton";
import { MongoDBSingleton } from "../../utils/mongodb-singleton";


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
        }
    }
}