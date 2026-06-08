import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Db, ObjectId } from 'mongodb';
import { MONGO_DB } from '../mongo/mongo.module';

function serialize(doc: any) {
  return {
    id: doc._id.toString(),
    name: doc.name,
    description: doc.description,
    price: doc.price, // cents
    imageUrl: doc.imageUrl,
    stock: doc.stock,
  };
}

function toObjectId(id: string): ObjectId {
  try {
    return new ObjectId(id);
  } catch {
    throw new NotFoundException('Product not found');
  }
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
    const doc = await this.col.findOne({ _id: toObjectId(id) });
    if (!doc) throw new NotFoundException('Product not found');
    return serialize(doc);
  }

  async create(body: any) {
    const doc = {
      name: String(body?.name || ''),
      description: String(body?.description || ''),
      price: Number(body?.price) || 0, // cents
      imageUrl: String(body?.imageUrl || ''),
      stock: Number(body?.stock) || 0,
    };
    const res = await this.col.insertOne(doc);
    return { id: res.insertedId.toString(), ...doc };
  }

  async update(id: string, body: any) {
    const _id = toObjectId(id);
    const set: Record<string, any> = {};
    if (body?.name !== undefined) set.name = String(body.name);
    if (body?.description !== undefined) set.description = String(body.description);
    if (body?.imageUrl !== undefined) set.imageUrl = String(body.imageUrl);
    if (body?.price !== undefined) set.price = Number(body.price);
    if (body?.stock !== undefined) set.stock = Number(body.stock);

    const res = await this.col.updateOne({ _id }, { $set: set });
    if (res.matchedCount === 0) throw new NotFoundException('Product not found');
    return this.findOne(id);
  }

  async remove(id: string) {
    const res = await this.col.deleteOne({ _id: toObjectId(id) });
    if (res.deletedCount === 0) throw new NotFoundException('Product not found');
    return { deleted: true };
  }
}
