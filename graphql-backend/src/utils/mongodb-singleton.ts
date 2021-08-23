import { Db, MongoClient } from "mongodb";
import { EnvLoader } from "./env-loader";

export class MongoDBSingleton {

    private static instance: MongoDBSingleton;
    public connection: Promise<MongoClient>;
    public db: Promise<Db>;

    public static getInstance(){
        if (!MongoDBSingleton.instance){
            MongoDBSingleton.instance = new MongoDBSingleton()
        }
        return MongoDBSingleton.instance;
    }

    private constructor(){
        const { MONGO_DB_ENDPOINT, DB_NAME } = EnvLoader.getInstance().loadedVariables;
        const client =  new MongoClient(MONGO_DB_ENDPOINT);
        this.connection = client.connect();
        this.db = this.connection.then(connection=>connection.db(DB_NAME))
    }
}