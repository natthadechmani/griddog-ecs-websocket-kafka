import { Module } from '@nestjs/common';
import { CheckoutModule } from './checkout/checkout.module';
import { HealthController } from './health.controller';
import { KafkaModule } from './kafka/kafka.module';
import { MongoModule } from './mongo/mongo.module';
import { ProductsModule } from './products/products.module';
import { RealtimeModule } from './realtime/realtime.module';

@Module({
  imports: [MongoModule, KafkaModule, RealtimeModule, ProductsModule, CheckoutModule],
  controllers: [HealthController],
})
export class AppModule {}
