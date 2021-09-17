import { Db, MongoClient } from "mongodb";
import { getLoadedEnvVariables } from "./env-loader";


function getMongoDBConnection(): { connection: Promise<MongoClient>, db: Promise<Db> } {
    console.log("MongoDB constructor called");
    const { MONGO_DB_ENDPOINT, DB_NAME } = getLoadedEnvVariables();
    const client = new MongoClient(MONGO_DB_ENDPOINT);
    const connection = client.connect().catch(reason => { console.log("error in init connect", reason) }) as Promise<MongoClient>;
    const db = connection?.then(connection => connection?.db(DB_NAME), error => {
        console.log("error in connection", error);
        this.internalConnection = Promise.resolve(null);
        client.close()
    }) as Promise<Db>
    return { connection, db }
}

export { getMongoDBConnection }