import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionButton } from '@/ui/components/action-button';
import type { CommitAction } from '@/ui/composer/commit-action';
import { spacing, typography } from '@/ui/theme/tokens';
import { useThemeColors } from '@/ui/theme/use-theme';

export interface ComposerFooterProps {
  /** The active mode's own input — a search field, a barcode box, nothing. */
  readonly input?: ReactNode;
  readonly commit: CommitAction;
  readonly onCommit: () => void;
  /** The status line, when there is something to say. */
  readonly message?: string | null;
}

/**
 * The two controls used every time, in the thumb zone.
 *
 * The mode's input and the button that ends the meal share one row, the input
 * taking whatever width the button leaves. Stacking them cost a second row of
 * height above the keyboard for no gain: the button's label is three words,
 * and the field does not need a phone's full width to hold "hotdog".
 *
 * Pinned above the keyboard by the sheet's `KeyboardAvoidingView`. That is a
 * structural answer to keyboard occlusion (THI-314) rather than a patch: a
 * field at the bottom cannot be covered by a keyboard that pushes it up.
 *
 * With the keyboard closed, the resting gap below the button still has to
 * clear the home indicator — the sheet has no native header or tab bar to
 * absorb that inset for it, so this claims the bottom safe area itself
 * rather than the flat `spacing.md` it used to sit on, which left the button
 * uncomfortably close to the edge on notched phones.
 *
 * The button always says why it is refusing. A disabled control with no
 * explanation teaches nothing and reads as broken, which is what THI-315 was
 * about.
 */
export function ComposerFooter({ input, commit, onCommit, message }: ComposerFooterProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderTopColor: colors.border,
        borderTopWidth: 1,
        gap: spacing.xs,
        paddingHorizontal: spacing.md,
        paddingTop: spacing.sm,
        paddingBottom: Math.max(spacing.md, insets.bottom),
      }}
    >
      {message ? (
        <Text
          accessibilityLiveRegion="polite"
          selectable
          allowFontScaling
          style={[
            typography.caption,
            { color: message.includes('added') ? colors.positive : colors.destructive },
          ]}
        >
          {message}
        </Text>
      ) : null}

      {commit.hint ? (
        <Text allowFontScaling style={[typography.caption, { color: colors.textSecondary }]}>
          {commit.hint}
        </Text>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        {input ? <View style={{ flex: 1 }}>{input}</View> : null}
        <ActionButton
          label={commit.label}
          accessibilityLabel={commit.accessibilityLabel}
          disabled={commit.disabled}
          onPress={onCommit}
          // With no input beside it the button takes the row; with one it
          // takes only what its label needs, and the field gets the rest.
          style={input ? undefined : { flex: 1 }}
        />
      </View>
    </View>
  );
}
