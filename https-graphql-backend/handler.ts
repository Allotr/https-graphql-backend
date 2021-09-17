import https from "https";
import * as http from "http";
import * as core from 'express-serve-static-core';

import schema from "./src/graphql/schemasMap";
import { getLoadedEnvVariables } from "./src/utils/env-loader";
import { graphqlHTTP } from 'express-graphql';
import { initializeGooglePassport, isLoggedIn } from "./src/auth/google-passport";
import { initializeWebPush } from "./src/notifications/web-push";
import { connectionMiddleware } from "utils/connection-utils";

async function handle(event: any, context: any, cb: any) {
  // When using graphqlHTTP this is not being executed
}

function onExpressServerCreated(app: core.Express) {
  // Create GraphQL HTTP server
  // IMPORTANT: ENVIRONMENT VARIABLES ONLY ARE AVAILABLE HERE AND ON onExpressServerListen
  initializeGooglePassport(app);
  initializeWebPush(app);
  app.use("/graphql", isLoggedIn, connectionMiddleware, graphqlHTTP(req => ({ schema, graphiql: true, context: req })));
}

async function onExpressServerListen(server: https.Server | http.Server) {
  // MongoDB Connection
  const { IS_HTTPS, HTTPS_PORT } = getLoadedEnvVariables();

  console.log(`GraphQL server running using ${Boolean(IS_HTTPS) ? "HTTPS" : "HTTP"} on port ${HTTPS_PORT}`);
}


export { handle, onExpressServerCreated, onExpressServerListen };
