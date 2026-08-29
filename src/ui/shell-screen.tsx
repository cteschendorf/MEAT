import type { ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';

type ShellScreenProps = {
  title: string;
  children?: ReactNode;
};

export function ShellScreen({ title, children }: ShellScreenProps) {
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 24, gap: 16 }}
    >
      <View style={{ gap: 8 }}>
        <Text selectable style={{ fontSize: 28, fontWeight: '700' }}>
          {title}
        </Text>
        {children}
      </View>
    </ScrollView>
  );
}
