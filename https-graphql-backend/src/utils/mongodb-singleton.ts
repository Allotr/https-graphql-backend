import { Db, MongoClient } from "mongodb";
import { EnvLoader } from "./env-loader";

export class MongoDBSingleton {

    private static instance: MongoDBSingleton;
    private internalConnection: Promise<MongoClient | null>;
    private internalDB: Promise<Db | void>;
    public connection: Promise<MongoClient>;
    public db: Promise<Db>;

    private async checkConnectionAndReconnect() {
        if ((await this.internalConnection.catch(err => null)) != null) {
            return;
        }
        console.log("Reconnecting... Hopefully it works now");
        // It will retry to conenct for 5 minutes. This is to solve race conditions at initial connections
        return new Promise<void>(resolve => {
            let counter = 0;
            const intervalId = setInterval(async () => {
                if ((await this.internalConnection.catch(err => null)) != null || counter > 15) {
                    console.log(counter <= 30 ? "Its working now!" : "Timed out retries...");
                    clearInterval(intervalId);
                    resolve();
                }
                console.log("Retries...")
                MongoDBSingleton.instance = new MongoDBSingleton()
                console.log("Result of reconnection: ",await this.internalConnection, MongoDBSingleton.instance)
                counter++;
            }, 20 * 1000)
        })
    }

    public static async getInstance() {
        if (!MongoDBSingleton.instance) {
            MongoDBSingleton.instance = new MongoDBSingleton()
        }
        await MongoDBSingleton.instance.checkConnectionAndReconnect();
        return MongoDBSingleton.instance;
    }

    private constructor() {
        console.log("MongoDB constructor called");
        const { MONGO_DB_ENDPOINT, DB_NAME } = EnvLoader.getInstance().loadedVariables;
        const client = new MongoClient(MONGO_DB_ENDPOINT);
        const dbConnection = client.connect().catch(reason => {
            console.log("error in init connect", reason)
        }) as Promise<MongoClient>;
        this.internalConnection = dbConnection;
        this.internalDB = dbConnection?.then(connection => connection?.db(DB_NAME), error => {
            console.log("error in connection", error);
            this.internalConnection = Promise.resolve(null);
            client.close()
        })
        this.connection = this.internalConnection as Promise<MongoClient>;
        this.db = this.internalDB as Promise<Db>
    }
}