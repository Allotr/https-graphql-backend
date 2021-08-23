import https from "https";
import * as http from "http";
import * as core from 'express-serve-static-core';

import schema from "./src/graphql/schemasMap";
import { EnvLoader } from "./src/utils/env-loader";
import { graphqlHTTP } from 'express-graphql';
import { MongoDBSingleton } from "./src/utils/mongodb-singleton";

async function handle(event: any, context: any, cb: any) {
  // When using graphqlHTTP this is not being executed
}

function onExpressServerCreated(expressServer: core.Express) {
  // Create GraphQL HTTP server
  expressServer.use(graphqlHTTP({ schema, graphiql: true }) as any);
}

async function onExpressServerListen(server: https.Server | http.Server) {
  // MongoDB Connection
  const { IS_HTTPS, HTTPS_PORT } = EnvLoader.getInstance().loadedVariables;
  MongoDBSingleton.getInstance()

  console.log(`GraphQL server running using ${Boolean(IS_HTTPS) ? "HTTPS" : "HTTP"} on port ${HTTPS_PORT}`);
}


export { handle, onExpressServerCreated, onExpressServerListen };
