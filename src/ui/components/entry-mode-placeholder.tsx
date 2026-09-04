import { ScrollView, Text, View } from 'react-native';

import { ActionButton } from '@/ui/components/action-button';
import { ScreenState } from '@/ui/components/screen-state';
import { entryTab, type EntryTabId } from '@/ui/composer/entry-tabs';
import { spacing, typography } from '@/ui/theme/tokens';
import { useThemeColors } from '@/ui/theme/use-theme';

export interface EntryModePlaceholderProps {
  readonly id: EntryTabId;
  readonly busy: boolean;
  /**
   * Opens the screen this mode still lives on, when it has one.
   *
   * Absent for a mode with nothing behind it yet, which is the difference
   * between "not built" and "not moved in here yet".
   */
  readonly onOpenRoute?: (() => void) | undefined;
  readonly routeLabel?: string;
  readonly detail?: string;
}

/**
 * A tab whose mode has not moved into the sheet yet.
 *
 * Two different situations share this component, and the copy keeps them
 * apart. **Not built** is AI: there is no feature behind the tab, and saying
 * so is the whole content. **Still its own screen** is Scan and Library: the
 * feature exists, works, and opens as a route — which is the round trip
 * THI-328 exists to remove, so the text says that plainly rather than
 * pretending the tab is finished.
 *
 * Naming the gap costs nothing and stops the shell from claiming more than it
 * has done.
 */
export function EntryModePlaceholder({
  id,
  busy,
  onOpenRoute,
  routeLabel,
  detail,
}: EntryModePlaceholderProps) {
  const colors = useThemeColors();
  const tab = entryTab(id);

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}
    >
      {tab.pending ? (
        <ScreenState title={tab.pending.title} message={tab.pending.message} />
      ) : (
        <View style={{ gap: spacing.sm }}>
          <ScreenState
            title={tab.title}
            message={detail ?? `${tab.title} still opens as its own screen.`}
          />
          {onOpenRoute && routeLabel ? (
            <>
              <ActionButton
                label={routeLabel}
                tone="secondary"
                disabled={busy}
                onPress={onOpenRoute}
              />
              <Text allowFontScaling style={[typography.caption, { color: colors.textSecondary }]}>
                This leaves the sheet and comes back. Your meal is kept while you are away.
              </Text>
            </>
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}
