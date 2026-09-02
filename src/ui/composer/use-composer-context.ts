import { useCallback, useState } from 'react';

import type { MealContextInput } from '@/domain';
import type { MealDraft } from '@/services/meals/meal-composer';
import {
  contextFromRawMealValues,
  isCustomMealTitle,
  rawMealContextForDraft,
} from '@/ui/meal-composer-state';
import { presetMealNames } from '@/ui/composer/meal-context';

export interface ComposerContextFields {
  readonly titleText: string;
  readonly setTitleText: (next: string) => void;
  readonly locationText: string;
  readonly setLocationText: (next: string) => void;
  readonly captionText: string;
  readonly setCaptionText: (next: string) => void;
  readonly customMealName: boolean;
  readonly setCustomMealName: (next: boolean) => void;
  readonly showContext: boolean;
  readonly setShowContext: (update: boolean | ((visible: boolean) => boolean)) => void;
  readonly pickerMode: 'date' | 'time' | null;
  readonly setPickerMode: (mode: 'date' | 'time' | null) => void;
  /** Adopts a draft's committed context as the editable text. */
  readonly hydrate: (draft: MealDraft) => void;
  /** The typed text as a context value, without trimming what is still being said. */
  readonly rawContextFor: (draft: MealDraft) => MealContextInput;
}

/**
 * The meal's name, location, notes, and the disclosure state around them.
 *
 * The text is held here rather than read off the draft each render because a
 * half-typed location is not yet a location. The draft holds committed values;
 * this holds what the user is in the middle of saying, and the two meet on
 * blur (THI-316).
 *
 * This hook owns state and nothing else. Deciding what a patch means lives in
 * `meal-context.ts`, and publishing belongs to the session — keeping those
 * apart is what stops this from needing a draft it cannot write to.
 */
export function useComposerContext(): ComposerContextFields {
  const [titleText, setTitleText] = useState('');
  const [locationText, setLocationText] = useState('');
  const [captionText, setCaptionText] = useState('');
  const [customMealName, setCustomMealName] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [pickerMode, setPickerMode] = useState<'date' | 'time' | null>(null);

  const hydrate = useCallback((draft: MealDraft) => {
    const raw = rawMealContextForDraft(draft);
    setTitleText(raw.title);
    setLocationText(raw.location);
    setCaptionText(raw.caption);
    setCustomMealName(isCustomMealTitle(raw.title, presetMealNames));
  }, []);

  const rawContextFor = useCallback(
    (draft: MealDraft): MealContextInput =>
      contextFromRawMealValues(draft, {
        title: titleText,
        location: locationText,
        caption: captionText,
      }),
    [titleText, locationText, captionText],
  );

  return {
    titleText,
    setTitleText,
    locationText,
    setLocationText,
    captionText,
    setCaptionText,
    customMealName,
    setCustomMealName,
    showContext,
    setShowContext,
    pickerMode,
    setPickerMode,
    hydrate,
    rawContextFor,
  };
}
