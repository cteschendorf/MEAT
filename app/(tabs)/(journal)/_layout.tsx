import { TabStack } from '@/ui/navigation/tab-stack';

export const unstable_settings = { anchor: 'journal' };

export default function JournalLayout() {
  return <TabStack screenName="journal" />;
}
