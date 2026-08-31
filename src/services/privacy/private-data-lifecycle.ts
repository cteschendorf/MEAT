import type { MediaRepository, PrivateDataRepository } from '@/data';
import type { MediaAssetFileStore } from '@/services/meals/meal-history';
import type { PrivateDataWriteCoordinator } from '@/services/privacy/private-data-write-coordinator';

interface PrivateMediaFileStore extends MediaAssetFileStore {
  deleteAll?(): Promise<void> | void;
}

interface PendingDeletionResetCoordinator {
  runExclusivePrivateDataReset(
    operation: (markDatabasePurged: () => void) => Promise<void>,
  ): Promise<void>;
}

interface ComposerSessionResetter {
  clearAll(): unknown;
}

/**
 * Coordinates the database and filesystem sides of private-data lifecycle.
 * Database deletion happens first; if a file removal is interrupted, startup
 * orphan cleanup can safely retry because no retained media row protects it.
 */
export class PrivateDataLifecycleService {
  constructor(
    private readonly privateData: PrivateDataRepository,
    private readonly media: MediaRepository,
    private readonly files: PrivateMediaFileStore,
    private readonly pendingDeletions?: PendingDeletionResetCoordinator,
    private readonly composerSessions?: ComposerSessionResetter,
    private readonly privateDataWrites?: PrivateDataWriteCoordinator,
  ) {}

  exportJson(): Promise<string> {
    return this.privateData.exportJson();
  }

  async deleteAll(): Promise<void> {
    const purge = async (
      markDatabasePurged: () => void,
      markWriteGenerationPurged: () => void,
    ): Promise<void> => {
      const assets = await this.media.list(2_147_483_647);
      await this.privateData.deleteAllPrivateData();
      markDatabasePurged();
      markWriteGenerationPurged();

      try {
        if (this.files.deleteAll) {
          await this.files.deleteAll();
        } else {
          for (const asset of assets) await this.files.delete(asset.uri);
        }
      } finally {
        // Any draft created before or during the purge may reference records or
        // files that no longer exist and must not be allowed to save afterward.
        this.composerSessions?.clearAll();
      }
    };

    const runReset = async (markWriteGenerationPurged: () => void): Promise<void> => {
      if (this.pendingDeletions) {
        await this.pendingDeletions.runExclusivePrivateDataReset(
          (markDatabasePurged) => purge(markDatabasePurged, markWriteGenerationPurged),
        );
        return;
      }
      await purge(() => undefined, markWriteGenerationPurged);
    };

    if (this.privateDataWrites) {
      await this.privateDataWrites.runPurge(runReset);
    } else {
      await runReset(() => undefined);
    }
  }
}
