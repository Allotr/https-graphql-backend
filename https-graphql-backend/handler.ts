import { getMongoDBConnection } from "./src/utils/mongodb-connector";
import { getRedisConnection } from "./src/utils/redis-connector";
import schema from "./src/graphql/schemasMap";
import { getLoadedEnvVariables } from "./src/utils/env-loader";
import { createYoga } from "graphql-yoga";
import { HttpRequest, HttpResponse, TemplatedApp } from "uWebSockets.js";
import { useGraphQlJit } from '@envelop/graphql-jit'
import { useParserCache } from "@envelop/parser-cache";
import { ObjectId } from "mongodb";
import cookie from "cookie";
// const { createYoga } = require('graphql-yoga');
// import { initializeGooglePassport, isLoggedIn } from "./src/auth/google-passport";
// import { initializeWebPush } from "./src/notifications/web-push";
// import { connectionMiddleware } from "./src/utils/connection-utils";
import { useResponseCache, UseResponseCacheParameter } from '@graphql-yoga/plugin-response-cache'
import { createRedisCache } from '@envelop/response-cache-redis'

interface ServerContext {
  req: HttpRequest
  res: HttpResponse
}

async function handle(app: TemplatedApp) {
  // When using graphqlHTTP this is not being executed
}

function onServerCreated(app: TemplatedApp) {
  // Create GraphQL HTTP server
  // IMPORTANT: ENVIRONMENT VARIABLES ONLY ARE AVAILABLE HERE AND ON onServerListen
  // initializeGooglePassport(app);
  // initializeWebPush(app);
  const redis = getRedisConnection().connection;
  const cache = createRedisCache({ redis }) as UseResponseCacheParameter["cache"]

  const yoga = createYoga<ServerContext>({
    schema,
    context: async ({ req, res }) => {
      return { // Context factory gets called for every request
        req,
        res,
        user: {
          _id: new ObjectId("612a571707eb3ecfcb604cde")
        },
        mongoDBConnection: getMongoDBConnection(),
        redisConnection: getRedisConnection(),
        cache
      }
    },
    graphiql: true,
    plugins: [
      useGraphQlJit(),
      useParserCache(),
      useResponseCache({
        session: (request) => {
          const cookieList = request.headers.get('cookie') ?? "";
          const parsedCookie = cookie.parse(cookieList);
          return parsedCookie?.['connect.sid'];
        },
        cache
      })
    ]
  })
  app
    // .any("/graphql", async (res, req) => {
    //   /* Can't return or yield from here without responding or attaching an abort handler */
    //   // res.onAborted(() => {
    //   //   res.done = true
    //   //   console.log(res.abortEvents);
    //   //   if (res.abortEvents) {
    //   //     res.abortEvents.forEach((f) => f())
    //   //   }
    //   // })
    
    //   // res.onAborted = (handler) => {
    //   //   res.abortEvents = res.abortEvents || []
    //   //   res.abortEvents.push(handler)
    //   //   return res
    //   // }

    //   /* Awaiting will yield and effectively return to C++, so you need to have called onAborted */
    //   let r = await yoga(res, req);

     
    // })
    .any("/graphql",
      // isLoggedIn,
      // connectionMiddleware,
      // graphqlHTTP(req => ({ schema, graphiql: true, context: req }))
      yoga
    );
}

async function onServerListen(app: TemplatedApp) {
  // MongoDB Connection
  const { IS_HTTPS, HTTPS_PORT } = getLoadedEnvVariables();

  console.log(`GraphQL server running using ${Boolean(IS_HTTPS) ? "HTTPS" : "HTTP"} on port ${HTTPS_PORT}`);
}


export { handle, onServerCreated, onServerListen };
