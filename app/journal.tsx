import { Text } from 'react-native';

import { ShellScreen } from '@/ui/shell-screen';

export default function JournalScreen() {
  return (
    <ShellScreen title="Journal">
      <Text selectable>Chronological meal history will live here.</Text>
    </ShellScreen>
  );
}
