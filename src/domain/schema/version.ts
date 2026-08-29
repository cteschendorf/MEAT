export const DOMAIN_SCHEMA_VERSION = 1 as const;

export interface VersionedDomainRecord {
  schemaVersion: typeof DOMAIN_SCHEMA_VERSION;
}
