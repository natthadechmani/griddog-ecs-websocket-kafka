import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { MongoModule } from './mongo/mongo.module';
import { ProductsModule } from './products/products.module';

@Module({
  imports: [MongoModule, ProductsModule],
  controllers: [HealthController],
})
export class AppModule {}
