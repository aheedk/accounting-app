import { Redirect, Tabs } from 'expo-router';
import { View } from 'react-native';
import { useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../../hooks/useAuth';
import type { AppTheme } from '../../theme';

export default function TabsLayout() {
  const { user, loading } = useAuth();
  const theme = useTheme<AppTheme>();

  if (loading) return null;
  if (!user) return <Redirect href="/(auth)/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.app.primary,
        tabBarInactiveTintColor: theme.app.mutedForeground,
        tabBarStyle: { backgroundColor: theme.app.surface, borderTopColor: theme.app.border },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Dashboard', tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="view-dashboard" color={color as string} size={size} /> }}
      />
      <Tabs.Screen
        name="transactions"
        options={{ title: 'Transactions', tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="format-list-bulleted" color={color as string} size={size} /> }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: '',
          tabBarIcon: ({ color }) => (
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.app.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
              <MaterialCommunityIcons name="plus" color={theme.app.primaryForeground} size={26} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: 'More', tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="menu" color={color as string} size={size} /> }}
      />
    </Tabs>
  );
}
