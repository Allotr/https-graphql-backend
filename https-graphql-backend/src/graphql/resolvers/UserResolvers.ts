
import { Resolvers, UserDbObject } from "allotr-graphql-schema-types";
import { MongoDBSingleton } from "../../utils/mongodb-singleton";
import { RedisSingleton } from "../../utils/redis-singleton";
import { ObjectId } from "mongodb"
import { generateChannelId } from "../../utils/data-util";
import { RESOURCE_READY_TO_PICK } from "../../consts/connection-tokens";
import { USERS } from "../../consts/collections";
import { sendNotification } from "../../notifications/web-push";

export const UserResolvers: Resolvers = {
  Query: {
    currentUser: (parent, args, context) => {

      // This is a random test
      // if (context.user.username === "rpernilfire222") {
      RedisSingleton.getInstance().pubsub.publish(generateChannelId(RESOURCE_READY_TO_PICK), {
        newResourceReady: {
          id: "id1",
          name: "test",
          createdBy: {
            userId: "88",
            username: "perico"
          },
          lastModificationDate: new Date()
        }
      });

      RedisSingleton.getInstance().pubsub.publish(generateChannelId(RESOURCE_READY_TO_PICK), {
        newResourceReady: {
          id: "id2",
          name: "test2",
          createdBy: {
            userId: "99",
            username: "edu"
          },
          lastModificationDate: new Date()
        }
      });
      // }


      return context.user;
    },
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
  }
}



