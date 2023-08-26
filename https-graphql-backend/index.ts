import { App } from "uWebSockets.js";
// @ts-ignore
import { handle, onServerCreated, onServerListen } from "./handler";
require('dotenv').config({ path: ".env" });

const app = App({});

// uWebSockets server created. Do any initialization required in the handler
onServerCreated(app);

const port = Number(process.env.http_port) || 3000;
app.listen(port, (listenSocket) => {
  if (listenSocket) {
    onServerListen(app)
  }
});
