import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, ScrollView, Text } from 'react-native';

import type { ISODateTime } from '@/domain/shared/ids';
import { MealDeletionExpiredError, openAppServices } from '@/services';
import { ActionButton, ScreenState, Surface, spacing, typography, useThemeColors } from '@/ui';
import { remainingUndoSeconds } from '@/ui/meal-deletion-presentation';
import { useMutationRouteGuard } from '@/ui/navigation/use-mutation-route-guard';

type DeletionStatus = 'loading' | 'undoable' | 'finalized' | 'restoring' | 'restored' | 'error';

function routeValue(value: string | readonly string[] | undefined): string | null {
  return typeof value === 'string' ? value : value?.[0] ?? null;
}

export function MealDeletedScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const token = routeValue(params.token);
  const [status, setStatus] = useState<DeletionStatus>(() => token ? 'loading' : 'error');
  const [expiresAt, setExpiresAt] = useState<ISODateTime | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [message, setMessage] = useState<string | null>(() => token ? null : 'The deletion could not be identified.');
  const queueRouteExit = useMutationRouteGuard(
    status === 'restoring',
    'Please wait while the meal event is restored.',
  );

  useEffect(() => {
    let mounted = true;
    let interval: ReturnType<typeof setInterval> | undefined;
    let finalizer: ReturnType<typeof setTimeout> | undefined;

    if (!token) {
      return () => {
        mounted = false;
      };
    }

    void openAppServices().then((services) => {
      const pending = services.mealHistory.getPendingDeletion(token);
      if (!pending) {
        if (mounted) {
          setStatus('finalized');
          setMessage('This meal has already been permanently deleted.');
        }
        return;
      }

      const expiration = Date.parse(pending.expiresAt);
      if (!Number.isFinite(expiration) || expiration <= Date.now()) {
        void services.mealHistory.finalizeDelete(token).finally(() => {
          if (mounted) {
            setStatus('finalized');
            setMessage('The undo window has ended.');
          }
        });
        return;
      }

      if (mounted) {
        setExpiresAt(pending.expiresAt);
        setStatus('undoable');
        setNow(Date.now());
      }
      AccessibilityInfo.announceForAccessibility('Meal deleted. Undo is available for 10 seconds.');
      interval = setInterval(() => {
        if (mounted) setNow(Date.now());
      }, 250);
      finalizer = setTimeout(() => {
        if (interval) clearInterval(interval);
        void services.mealHistory.finalizeDelete(token).finally(() => {
          if (mounted) {
            setNow(Date.now());
            setStatus('finalized');
            setMessage('The undo window has ended.');
            AccessibilityInfo.announceForAccessibility('Meal permanently deleted.');
          }
        });
      }, Math.max(0, expiration - Date.now()));
    }).catch((caught: unknown) => {
      if (!mounted) return;
      setStatus('error');
      setMessage(caught instanceof Error ? caught.message : 'Unable to manage this deletion.');
    });

    return () => {
      mounted = false;
      if (interval) clearInterval(interval);
      // The finalizer deliberately remains scheduled so media is disposed after the undo window.
      void finalizer;
    };
  }, [token]);

  const remainingSeconds = remainingUndoSeconds(expiresAt, now);

  const undo = useCallback(async () => {
    if (!token || status !== 'undoable') return;
    setStatus('restoring');
    try {
      const services = await openAppServices();
      const restored = await services.mealHistory.undoDelete(
        token,
        new Date().toISOString() as ISODateTime,
      );
      AccessibilityInfo.announceForAccessibility('Meal restored.');
      queueRouteExit(() => router.dismissTo({
        pathname: '/meal/[id]',
        params: { id: restored.id },
      }));
      setStatus('restored');
    } catch (caught) {
      const expired = caught instanceof MealDeletionExpiredError;
      const nextMessage = expired
        ? 'The undo window has ended.'
        : caught instanceof Error ? caught.message : 'Unable to restore this meal.';
      setStatus(expired ? 'finalized' : 'error');
      setMessage(nextMessage);
      AccessibilityInfo.announceForAccessibility(nextMessage);
    }
  }, [queueRouteExit, router, status, token]);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ gap: spacing.lg, padding: spacing.md, paddingBottom: spacing.xxl }}
      style={{ backgroundColor: colors.background }}
    >
      <Surface>
        {status === 'loading' ? (
          <ScreenState title="Deleting meal" message="Preparing the undo window…" />
        ) : null}
        {status === 'undoable' || status === 'restoring' ? (
          <>
            <ScreenState
              title="Meal deleted"
              message="Its photos stay protected until the undo window ends."
              role="alert"
            />
            <Text
              accessibilityLiveRegion="polite"
              allowFontScaling
              selectable
              style={[typography.bodyStrong, { color: colors.textPrimary, fontVariant: ['tabular-nums'], textAlign: 'center' }]}
            >
              Undo available for {remainingSeconds} {remainingSeconds === 1 ? 'second' : 'seconds'}
            </Text>
            <ActionButton
              disabled={status === 'restoring' || remainingSeconds === 0}
              label={status === 'restoring' ? 'Restoring…' : 'Undo delete'}
              onPress={() => void undo()}
            />
          </>
        ) : null}
        {status === 'finalized' || status === 'error' ? (
          <>
            <ScreenState
              title={status === 'finalized' ? 'Deletion complete' : 'Deletion unavailable'}
              {...(message ? { message } : {})}
              role={status === 'error' ? 'alert' : 'status'}
            />
            <ActionButton label="Return to Today" tone="secondary" onPress={() => router.dismissTo('/')} />
          </>
        ) : null}
        {status === 'restored' ? (
          <ScreenState title="Meal restored" message="Returning to the restored event…" role="status" />
        ) : null}
      </Surface>
    </ScrollView>
  );
}

export default MealDeletedScreen;
