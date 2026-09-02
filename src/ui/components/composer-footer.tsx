import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

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
 * The mode's input and the button that ends the meal sit at the bottom,
 * pinned above the keyboard by the sheet's `KeyboardAvoidingView`. That is a
 * structural answer to keyboard occlusion (THI-314) rather than a patch: a
 * field at the bottom cannot be covered by a keyboard that pushes it up.
 *
 * The button always says why it is refusing. A disabled control with no
 * explanation teaches nothing and reads as broken, which is what THI-315 was
 * about.
 */
export function ComposerFooter({ input, commit, onCommit, message }: ComposerFooterProps) {
  const colors = useThemeColors();

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderTopColor: colors.border,
        borderTopWidth: 1,
        gap: spacing.xs,
        paddingHorizontal: spacing.md,
        paddingTop: spacing.sm,
        paddingBottom: spacing.md,
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

      {input}

      {commit.hint ? (
        <Text allowFontScaling style={[typography.caption, { color: colors.textSecondary }]}>
          {commit.hint}
        </Text>
      ) : null}

      <ActionButton
        label={commit.label}
        accessibilityLabel={commit.accessibilityLabel}
        disabled={commit.disabled}
        onPress={onCommit}
      />
    </View>
  );
}
