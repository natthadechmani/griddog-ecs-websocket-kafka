import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Db, ObjectId } from 'mongodb';
import { MONGO_DB } from '../mongo/mongo.module';

export function serialize(doc: any) {
  return {
    id: doc._id.toString(),
    name: doc.name,
    description: doc.description,
    price: doc.price, // cents
    imageUrl: doc.imageUrl,
    stock: doc.stock,
  };
}

@Injectable()
export class ProductsService {
  constructor(@Inject(MONGO_DB) private readonly db: Db) {}

  private get col() {
    return this.db.collection('products');
  }

  async findAll() {
    const docs = await this.col.find().toArray();
    return docs.map(serialize);
  }

  async findOne(id: string) {
    let _id: ObjectId;
    try {
      _id = new ObjectId(id);
    } catch {
      throw new NotFoundException('Product not found');
    }
    const doc = await this.col.findOne({ _id });
    if (!doc) throw new NotFoundException('Product not found');
    return serialize(doc);
  }
}
