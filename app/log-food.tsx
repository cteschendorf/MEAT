import { Link, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';

import type { Food, ISODateTime } from '@/domain';
import { LocalFoodCorpus, openMeatDatabase, SqliteFoodRepository, SqliteMealRepository } from '@/data';
import { FoodLoggingService, defaultLocalIdFactory } from '@/services/logging/food-logging';
import { ActionButton, Surface, spacing, typography, useThemeColors } from '@/ui';

export default function LogFoodScreen() {
  const colors=useThemeColors(),router=useRouter();
  const [service,setService]=useState<FoodLoggingService|null>(null);
  const [query,setQuery]=useState(''),[results,setResults]=useState<ReadonlyArray<Food>>([]);
  const [selected,setSelected]=useState<Food|null>(null),[grams,setGrams]=useState('100'),[message,setMessage]=useState<string|null>(null);

  useEffect(()=>{let active=true;void openMeatDatabase().then((db)=>{if(active)setService(new FoodLoggingService(new LocalFoodCorpus(db),new SqliteFoodRepository(db),new SqliteMealRepository(db),defaultLocalIdFactory))}).catch((e:unknown)=>active&&setMessage(e instanceof Error?e.message:'Unable to open food database.'));return()=>{active=false}},[]);

  async function search(){if(!service||!query.trim())return;setMessage(null);try{setResults((await service.search(query)).map((r)=>r.food))}catch(e){setMessage(e instanceof Error?e.message:'Search failed.')}}
  async function log(){if(!service||!selected)return;const amount=Number(grams);if(!Number.isFinite(amount)||amount<=0){setMessage('Enter a portion greater than zero grams.');return}try{await service.logFood(selected,amount,new Date().toISOString() as ISODateTime);router.back()}catch(e){setMessage(e instanceof Error?e.message:'Unable to log food.')}}

  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{padding:spacing.md,gap:spacing.md,backgroundColor:colors.background}} keyboardShouldPersistTaps="handled">
    <Text allowFontScaling selectable style={[typography.title1,{color:colors.textPrimary}]}>Log food</Text>
    <Surface>
      <TextInput accessibilityLabel="Search foods" placeholder="Search foods" placeholderTextColor={colors.textSecondary} value={query} onChangeText={setQuery} onSubmitEditing={()=>void search()} returnKeyType="search" style={[typography.body,{color:colors.textPrimary,borderColor:colors.border,borderWidth:1,borderRadius:12,padding:12}]} />
      <ActionButton label="Search" onPress={()=>void search()} disabled={!service||!query.trim()} />
      <Link href="/manual-food" asChild><ActionButton label="Create a food manually" tone="secondary" /></Link>
    </Surface>
    {message?<Text accessibilityLiveRegion="polite" selectable style={[typography.body,{color:colors.destructive}]}>{message}</Text>:null}
    {results.map((food)=><Surface key={food.id} tone={selected?.id===food.id?'muted':'default'}>
      <Text allowFontScaling selectable style={[typography.bodyStrong,{color:colors.textPrimary}]}>{food.name}</Text>
      {food.brand?<Text allowFontScaling selectable style={[typography.caption,{color:colors.textSecondary}]}>{food.brand}</Text>:null}
      <ActionButton label={selected?.id===food.id?'Selected':'Select'} tone="secondary" onPress={()=>{setSelected(food);setGrams(String(food.servings.find((s)=>s.isDefault)?.gramWeight??100))}} />
    </Surface>)}
    {selected?<Surface><Text allowFontScaling style={[typography.bodyStrong,{color:colors.textPrimary}]}>Portion for {selected.name}</Text><View style={{flexDirection:'row',alignItems:'center',gap:spacing.sm}}><TextInput accessibilityLabel="Portion in grams" keyboardType="decimal-pad" value={grams} onChangeText={setGrams} style={[typography.body,{flex:1,color:colors.textPrimary,borderColor:colors.border,borderWidth:1,borderRadius:12,padding:12}]} /><Text style={[typography.body,{color:colors.textSecondary}]}>g</Text></View><ActionButton label="Log food" onPress={()=>void log()} /></Surface>:null}
  </ScrollView>;
}
