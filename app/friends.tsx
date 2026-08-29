import { Text } from 'react-native';

import { ShellScreen } from '@/ui/shell-screen';

export default function FriendsScreen() {
  return (
    <ShellScreen title="Friends">
      <Text selectable>Shared food moments will live here.</Text>
    </ShellScreen>
  );
}
