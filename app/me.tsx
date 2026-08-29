import { Text } from 'react-native';

import { ShellScreen } from '@/ui/shell-screen';

export default function MeScreen() {
  return (
    <ShellScreen title="Me">
      <Text selectable>Profile, goals, and settings will live here.</Text>
    </ShellScreen>
  );
}
