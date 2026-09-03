import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import type { MediaAsset } from '@/domain';
import type { MediaId } from '@/domain/shared/ids';
import type { LocalMealPhoto } from '@/platform';
import { ActionButton } from '@/ui/components/action-button';
import { presetMealNames } from '@/ui/composer/meal-context';
import { minimumTouchTarget, radii, spacing, typography } from '@/ui/theme/tokens';
import { useThemeColors } from '@/ui/theme/use-theme';

const MAX_PHOTOS = 5;

export interface ComposerMealDetailsProps {
  readonly visible: boolean;
  readonly occurredAt: Date;
  readonly customName: boolean;
  readonly titleText: string;
  /** The name this hour usually goes by, outlined when none is chosen. */
  readonly suggestedMealName: (typeof presetMealNames)[number];
  readonly onChooseMealName: (name: string | null) => void;
  readonly locationText: string;
  readonly captionText: string;
  readonly photos: readonly (MediaAsset | LocalMealPhoto)[];
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onOpenPicker: (mode: 'date' | 'time') => void;
  /**
   * The date-time picker, when one is open.
   *
   * Rendered here rather than beside the sheet: on iOS a picker mounted behind
   * a modal is simply not visible, so the control would silently do nothing.
   */
  readonly picker?: ReactNode;
  readonly onUseCustomName: () => void;
  readonly onChangeTitle: (next: string) => void;
  readonly onCommitTitle: () => void;
  readonly onChangeLocation: (next: string) => void;
  readonly onCommitLocation: () => void;
  readonly onChangeCaption: (next: string) => void;
  readonly onCommitCaption: () => void;
  readonly onAddPhoto: (source: 'camera' | 'library') => void;
  readonly onRemovePhoto: (id: MediaId) => void;
}

/**
 * When it happened, what it was called, where, and what it looked like.
 *
 * These are properties of the meal rather than of the way a food was found, so
 * they belong to the sheet's header rather than to any one tab. They live
 * behind a press instead of on the surface because the common case is logging
 * a food and leaving: on the reference surface these fields are not visible at
 * all, and burying them in the scroll — where they were — put five controls
 * nobody usually wants between the search box and the save button (THI-328).
 */
export function ComposerMealDetails(props: ComposerMealDetailsProps) {
  const colors = useThemeColors();
  if (!props.visible) return null;

  const {
    occurredAt,
    customName,
    titleText,
    suggestedMealName,
    onChooseMealName,
    locationText,
    captionText,
    photos,
    busy,
    onClose,
    onOpenPicker,
    onUseCustomName,
    onChangeTitle,
    onCommitTitle,
    onChangeLocation,
    onCommitLocation,
    onChangeCaption,
    onCommitCaption,
    onAddPhoto,
    onRemovePhoto,
    picker,
  } = props;

  const field = [
    typography.body,
    {
      color: colors.textPrimary,
      backgroundColor: colors.background,
      borderColor: colors.borderStrong,
      borderWidth: 1,
      borderRadius: radii.sm,
      padding: spacing.sm,
    },
  ];

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close meal details"
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }}
      />
      <View
        style={{
          maxHeight: '86%',
          backgroundColor: colors.surface,
          borderTopLeftRadius: radii.lg,
          borderTopRightRadius: radii.lg,
          borderTopWidth: 1,
          borderColor: colors.border,
        }}
      >
        <View
          accessible={false}
          style={{
            alignSelf: 'center',
            width: 38,
            height: 4,
            borderRadius: radii.capsule,
            backgroundColor: colors.border,
            marginTop: spacing.xs,
          }}
        />
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}
        >
          <Text accessibilityRole="header" allowFontScaling style={[typography.title3, { color: colors.textPrimary }]}>
            Meal details
          </Text>

          <Text allowFontScaling style={[typography.bodyStrong, { color: colors.textPrimary }]}>
            {occurredAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <ActionButton
              label="Change date"
              tone="secondary"
              disabled={busy}
              style={{ flex: 1 }}
              onPress={() => onOpenPicker('date')}
            />
            <ActionButton
              label="Change time"
              tone="secondary"
              disabled={busy}
              style={{ flex: 1 }}
              onPress={() => onOpenPicker('time')}
            />
          </View>
          {picker}

          <Text allowFontScaling style={[typography.bodyStrong, { color: colors.textPrimary }]}>
            Meal name
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            <NameChip
              label="None"
              selected={!titleText}
              suggested={false}
              disabled={busy}
              onPress={() => onChooseMealName(null)}
            />
            {presetMealNames.map((name) => (
              <NameChip
                key={name}
                label={name}
                selected={titleText === name}
                // Outlined, not filled: a proposal from the clock, not a claim
                // about what the meal was. Only a tap makes it the latter.
                suggested={!titleText && name === suggestedMealName}
                disabled={busy}
                onPress={() => onChooseMealName(name)}
              />
            ))}
          </View>

          {customName ? (
            <TextInput
              accessibilityLabel="Custom meal name"
              placeholder="Meal name"
              placeholderTextColor={colors.textSecondary}
              value={titleText}
              maxLength={80}
              onChangeText={onChangeTitle}
              onBlur={onCommitTitle}
              style={field}
            />
          ) : (
            <ActionButton
              label="Use a custom meal name"
              tone="secondary"
              disabled={busy}
              onPress={onUseCustomName}
            />
          )}

          <TextInput
            accessibilityLabel="Meal location"
            accessibilityHint="Optional manual label. MEAT does not request your device location."
            placeholder="Location (optional)"
            placeholderTextColor={colors.textSecondary}
            value={locationText}
            maxLength={120}
            onChangeText={onChangeLocation}
            onBlur={onCommitLocation}
            style={field}
          />

          <TextInput
            accessibilityLabel="Meal notes"
            placeholder="Notes (optional)"
            placeholderTextColor={colors.textSecondary}
            value={captionText}
            maxLength={500}
            multiline
            onChangeText={onChangeCaption}
            onBlur={onCommitCaption}
            style={[...field, { minHeight: 96, textAlignVertical: 'top' as const }]}
          />

          <Text allowFontScaling style={[typography.bodyStrong, { color: colors.textPrimary }]}>
            Photos · {photos.length}/{MAX_PHOTOS}
          </Text>
          <Text allowFontScaling style={[typography.caption, { color: colors.textSecondary }]}>
            Photos stay private on this device. MEAT re-encodes them without EXIF metadata.
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {photos.map((photo) => (
              <View key={photo.id} style={{ width: 112, gap: spacing.xs }}>
                <Image
                  source={{ uri: photo.uri }}
                  accessibilityLabel="Meal photo"
                  style={{ width: 112, height: 84, borderRadius: radii.sm }}
                  contentFit="cover"
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove photo"
                  disabled={busy}
                  onPress={() => onRemovePhoto(photo.id)}
                  style={(state) => ({
                    minHeight: minimumTouchTarget,
                    justifyContent: 'center',
                    opacity: busy ? 0.45 : state.pressed ? 0.7 : 1,
                  })}
                >
                  <Text allowFontScaling style={[typography.caption, { color: colors.destructive }]}>
                    Remove photo
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
          <ActionButton
            label="Take photo"
            tone="secondary"
            disabled={busy || photos.length >= MAX_PHOTOS}
            onPress={() => onAddPhoto('camera')}
          />
          <ActionButton
            label="Choose from library"
            tone="secondary"
            disabled={busy || photos.length >= MAX_PHOTOS}
            onPress={() => onAddPhoto('library')}
          />

          <ActionButton label="Done" onPress={onClose} />
        </ScrollView>
      </View>
    </Modal>
  );
}

interface NameChipProps {
  readonly label: string;
  readonly selected: boolean;
  readonly suggested: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}

function NameChip({ label, selected, suggested, disabled, onPress }: NameChipProps) {
  const colors = useThemeColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={suggested ? `${label}, suggested for this time of day` : label}
      disabled={disabled}
      onPress={onPress}
      style={(state) => ({
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: minimumTouchTarget,
        paddingHorizontal: spacing.sm,
        borderRadius: radii.capsule,
        borderWidth: 1,
        borderColor: selected || suggested ? colors.brand : colors.border,
        backgroundColor: selected ? colors.brand : 'transparent',
        opacity: disabled ? 0.45 : state.pressed ? 0.7 : 1,
      })}
    >
      <Text
        allowFontScaling
        style={[
          selected ? typography.bodyStrong : typography.body,
          { color: selected ? colors.textOnAction : colors.textPrimary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
