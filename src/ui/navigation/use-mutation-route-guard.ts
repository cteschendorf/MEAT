import { useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { DeferredRouteExit } from '@/ui/navigation/deferred-route-exit';

const DEFAULT_BLOCKED_MESSAGE = 'Please wait for the current action to finish.';

/**
 * Prevents header, gesture, and hardware-back removal while a guarded mutation
 * is running. Successful exits are queued until React has released the native
 * removal guard, so the intended navigation is not accidentally prevented too.
 */
export function useMutationRouteGuard(
  blocked: boolean,
  blockedMessage = DEFAULT_BLOCKED_MESSAGE,
): (action: () => void) => void {
  const navigation = useNavigation();
  const [exit] = useState(() => new DeferredRouteExit());
  const [queueVersion, setQueueVersion] = useState(0);

  useLayoutEffect(() => {
    navigation.setOptions({ headerBackButtonMenuEnabled: false });
  }, [navigation]);

  usePreventRemove(
    blocked,
    useCallback(() => {
      AccessibilityInfo.announceForAccessibility(blockedMessage);
    }, [blockedMessage]),
  );

  useEffect(() => {
    exit.flush(blocked);
  }, [blocked, exit, queueVersion]);

  useEffect(() => () => exit.clear(), [exit]);

  return useCallback((action: () => void) => {
    if (exit.queue(action)) setQueueVersion((version) => version + 1);
  }, [exit]);
}
