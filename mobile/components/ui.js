import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export const C = {
  bg: '#F5F3EE',
  ink: '#17181B',
  muted: '#5B5D63',
  line: '#DDD8CC',
  lineSoft: '#EEEBE3',
  card: '#FFFFFF',
  brass: '#E3C27A',
  brassInk: '#7A5712',
  warnBg: '#F6ECD6',
  bad: '#9A3412',
  badBg: '#FDE7DC',
  good: '#166534',
  goodBg: '#E3F1E4',
  darkSoft: '#24262A',
  darkMuted: '#C9C6BD',
};

export function Screen({ children, onRefresh, scroll = true, edges = ['top'] }) {
  const [refreshing, setRefreshing] = useState(false);
  const refresh = onRefresh ? async () => { setRefreshing(true); await onRefresh(); setRefreshing(false); } : undefined;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={edges}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={s.screen}
          keyboardShouldPersistTaps="handled"
          refreshControl={refresh ? <RefreshControl refreshing={refreshing} onRefresh={refresh} /> : undefined}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[s.screen, { flex: 1 }]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Title({ children, sub }) {
  return (
    <View style={{ gap: 2 }}>
      {sub ? <Text style={s.small}>{sub}</Text> : null}
      <Text style={s.h1}>{children}</Text>
    </View>
  );
}

export function H2({ children }) {
  return <Text style={s.h2}>{children}</Text>;
}

export function T({ children, style, muted, small, tiny, strong, ...rest }) {
  return (
    <Text
      style={[
        { color: C.ink, fontSize: 15 },
        small && { fontSize: 13 },
        tiny && { fontSize: 12 },
        muted && { color: C.muted },
        strong && { fontWeight: '600' },
        style,
      ]}
      {...rest}
    >
      {children}
    </Text>
  );
}

export function Card({ children, dark, style }) {
  return <View style={[s.card, dark && { backgroundColor: C.ink }, style]}>{children}</View>;
}

export function List({ children }) {
  return <View style={s.list}>{children}</View>;
}

export function Item({ children, last, style, onPress }) {
  const body = <View style={[s.item, last && { borderBottomWidth: 0 }, style]}>{children}</View>;
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button">{body}</Pressable> : body;
}

export function Button({ title, onPress, kind = 'plain', small, disabled, style, loading }) {
  const bg = kind === 'dark' ? C.ink : kind === 'brass' ? C.brass : C.card;
  const fg = kind === 'dark' ? C.bg : C.ink;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        s.btn,
        small && s.btnSmall,
        { backgroundColor: bg, borderColor: kind === 'plain' ? C.line : bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontWeight: '600', fontSize: small ? 13 : 15 }}>{title}</Text>}
    </Pressable>
  );
}

export function Chip({ title, selected, onPress, style }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={[s.chip, selected && { backgroundColor: C.ink, borderColor: C.ink }, style]}
    >
      <Text style={{ color: selected ? C.bg : C.ink, fontWeight: '600' }}>{title}</Text>
    </Pressable>
  );
}

export function Field({ label, style, inputStyle, ...props }) {
  return (
    <View style={[{ gap: 4 }, style]}>
      <Text style={s.small}>{label}</Text>
      <TextInput placeholderTextColor="#9A9CA1" style={[s.input, inputStyle]} {...props} />
    </View>
  );
}

const BADGE = {
  bad: [C.bad, C.badBg],
  warn: [C.brassInk, C.warnBg],
  good: [C.good, C.goodBg],
  plain: [C.muted, '#F0EDE5'],
};

export function Badge({ kind = 'plain', children }) {
  const [fg, bg] = BADGE[kind];
  return (
    <View style={{ backgroundColor: bg, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: '600' }}>{children}</Text>
    </View>
  );
}

export function ErrorText({ children }) {
  if (!children) return null;
  return <Text style={s.error}>{children}</Text>;
}

export function Notice({ children }) {
  return <View style={s.notice}><Text style={{ color: C.ink }}>{children}</Text></View>;
}

export function Row({ children, style, wrap }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8 }, wrap && { flexWrap: 'wrap' }, style]}>{children}</View>;
}

export function Stat({ label, value, style }) {
  return (
    <Card style={[{ flex: 1, minWidth: 140 }, style]}>
      <T tiny muted>{label}</T>
      <Text style={s.stat}>{value}</Text>
    </Card>
  );
}

export function Picker({ label, value, options, onChange }) {
  return (
    <View style={{ gap: 4 }}>
      {label ? <Text style={s.small}>{label}</Text> : null}
      <Row wrap>
        {options.map((o) => (
          <Chip key={String(o.value)} title={o.label} selected={value === o.value} onPress={() => onChange(o.value)} style={{ minHeight: 38 }} />
        ))}
      </Row>
    </View>
  );
}

export const s = StyleSheet.create({
  screen: { padding: 20, paddingBottom: 48, gap: 18 },
  h1: { fontSize: 26, fontWeight: '700', color: C.ink, letterSpacing: -0.5 },
  h2: { fontSize: 13, fontWeight: '600', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },
  small: { fontSize: 13, color: C.muted },
  card: { backgroundColor: C.card, borderRadius: 14, padding: 14, gap: 8 },
  list: { backgroundColor: C.card, borderRadius: 14, overflow: 'hidden' },
  item: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.lineSoft, flexDirection: 'row', alignItems: 'center', gap: 12 },
  btn: { minHeight: 44, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  btnSmall: { minHeight: 36, paddingHorizontal: 12, borderRadius: 10 },
  chip: { minHeight: 44, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.card, paddingHorizontal: 12, paddingVertical: 8, fontSize: 16, color: C.ink },
  error: { color: C.bad, backgroundColor: C.badBg, padding: 10, borderRadius: 10, overflow: 'hidden' },
  notice: { backgroundColor: C.warnBg, padding: 12, borderRadius: 10 },
  stat: { fontSize: 26, fontWeight: '600', color: C.ink },
});
