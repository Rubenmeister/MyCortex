import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/lib/auth';

export default function SettingsScreen() {
  const router = useRouter();
  const { session, signOut } = useAuth();

  const onSignOut = async () => {
    Alert.alert('Cerrar sesión', '¿Seguro?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Salir',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  return (
    <View style={styles.root}>
      <View style={styles.section}>
        <Text style={styles.label}>Sesión</Text>
        <Text style={styles.value}>{session?.user.email}</Text>
        <Text style={styles.subtle}>{session?.user.id.slice(0, 8)}…</Text>
      </View>

      <TouchableOpacity style={styles.signOut} onPress={onSignOut}>
        <Text style={styles.signOutText}>Cerrar sesión</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a', padding: 16, gap: 16 },
  section: { backgroundColor: '#1a1a1a', padding: 16, borderRadius: 12, gap: 4 },
  label: { color: '#666', fontSize: 12, marginBottom: 4 },
  value: { color: '#fff', fontSize: 16, fontWeight: '600' },
  subtle: { color: '#666', fontSize: 12, fontFamily: 'Courier' },
  signOut: { backgroundColor: '#3a1a1a', padding: 16, borderRadius: 12, alignItems: 'center' },
  signOutText: { color: '#ff6b6b', fontWeight: '700', fontSize: 15 },
});
