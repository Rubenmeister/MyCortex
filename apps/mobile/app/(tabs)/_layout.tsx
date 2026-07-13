import { Tabs } from 'expo-router';
import { Text } from 'react-native';

const ICON_SIZE = 22;

function Icon({ children, color }: { children: string; color: string }) {
  return <Text style={{ fontSize: ICON_SIZE, color }}>{children}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#fff',
        tabBarInactiveTintColor: '#666',
        tabBarStyle: { backgroundColor: '#0a0a0a', borderTopColor: '#1a1a1a' },
        headerStyle: { backgroundColor: '#0a0a0a' },
        headerTitleStyle: { color: '#fff', fontSize: 18, fontWeight: '700' },
      }}
    >
      <Tabs.Screen
        name="coach"
        options={{ title: 'Coach', tabBarIcon: ({ color }) => <Icon color={color}>🎯</Icon> }}
      />
      <Tabs.Screen
        name="index"
        options={{ title: 'Capturar', tabBarIcon: ({ color }) => <Icon color={color}>✎</Icon> }}
      />
      <Tabs.Screen
        name="chat"
        options={{ title: 'Hablar', tabBarIcon: ({ color }) => <Icon color={color}>🗨️</Icon> }}
      />
      <Tabs.Screen
        name="tasks"
        options={{ title: 'Tareas', tabBarIcon: ({ color }) => <Icon color={color}>✅</Icon> }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: 'Más', tabBarIcon: ({ color }) => <Icon color={color}>⋯</Icon> }}
      />

      {/* Rutas que existen pero no van en la barra (se llegan desde "Más"). */}
      <Tabs.Screen name="context" options={{ href: null, title: 'Contexto' }} />
      <Tabs.Screen name="settings" options={{ href: null, title: 'Ajustes' }} />
      <Tabs.Screen name="ask" options={{ href: null, title: 'Preguntar' }} />
      <Tabs.Screen name="nodes" options={{ href: null, title: 'Notas' }} />
      <Tabs.Screen name="diario" options={{ href: null, title: 'Diario' }} />
      <Tabs.Screen name="grafo" options={{ href: null, title: 'Grafo' }} />
      <Tabs.Screen name="agenda" options={{ href: null, title: 'Agenda' }} />
      <Tabs.Screen name="going" options={{ href: null, title: 'Going' }} />
    </Tabs>
  );
}
