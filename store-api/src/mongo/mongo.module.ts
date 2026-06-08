import { Global, Module } from '@nestjs/common';
import { Db, MongoClient } from 'mongodb';

export const MONGO_DB = 'MONGO_DB';

/**
 * Connects to MongoDB once at startup using the native `mongodb` v4 driver
 * (chosen over mongoose for compatibility with MongoDB server 8.0).
 * The database name is taken from MONGO_URI, or MONGO_DB_NAME if set.
 */
@Global()
@Module({
  providers: [
    {
      provide: MONGO_DB,
      useFactory: async (): Promise<Db> => {
        const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/griddog';
        const client = new MongoClient(uri);
        await client.connect();
        // eslint-disable-next-line no-console
        console.log('Connected to MongoDB');
        return process.env.MONGO_DB_NAME ? client.db(process.env.MONGO_DB_NAME) : client.db();
      },
    },
  ],
  exports: [MONGO_DB],
})
export class MongoModule {}
