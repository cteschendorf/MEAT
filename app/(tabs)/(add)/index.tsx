import { Redirect } from 'expo-router';

/**
 * The centre tab is a button, not a destination.
 *
 * Expo Router needs a file behind every tab, but pressing this one is
 * intercepted in the tab layout and opens the composer instead. This redirect
 * is the safety net for the one way a user can still land here — a deep link
 * or a restored navigation state — so it goes to the same place the press
 * would have.
 */
export default function AddTab() {
  return <Redirect href="/log-food" />;
}
