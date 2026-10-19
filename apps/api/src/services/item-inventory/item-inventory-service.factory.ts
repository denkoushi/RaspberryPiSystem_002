import { resolveGmailApiClientFromBackupConfig } from '../gmail/gmail-api-client.factory.js';
import { ItemInventoryGmailIngestionService } from './item-inventory-gmail-ingestion.service.js';
import { ItemInventoryService } from './item-inventory.service.js';

export type ItemInventoryServices = {
  inventory: ItemInventoryService;
  ingestion: ItemInventoryGmailIngestionService;
};

let services: ItemInventoryServices | null = null;

export function getItemInventoryServices(): ItemInventoryServices {
  if (services) return services;
  services = {
    inventory: new ItemInventoryService(),
    ingestion: new ItemInventoryGmailIngestionService(async (config, options) =>
      resolveGmailApiClientFromBackupConfig(config, options)
    ),
  };
  return services;
}

export function resetItemInventoryServicesForTests(): void {
  services = null;
}
