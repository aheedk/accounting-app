import { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming, Easing } from 'react-native-reanimated';
import { useTheme } from 'react-native-paper';
import type { AppTheme } from '../theme';

/**
 * The mobile counterpart of the web app's .loading-dots: three dots pulsing
 * in a staggered wave, in the brand blue — the same animation concept
 * (not QBO's bouncing green dots), done with Reanimated instead of CSS
 * @keyframes so it stays at 60fps on the UI thread.
 */
function Dot({ delay, color, size }: { delay: number; color: string; size: number }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 330, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: 770, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: 0.4 + progress.value * 0.6,
    transform: [{ scale: 0.6 + progress.value * 0.4 }],
  }));

  return <Animated.View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />;
}

export function LoadingIndicator({ size = 'default' }: { size?: 'default' | 'sm' }) {
  const theme = useTheme<AppTheme>();
  const dotSize = size === 'sm' ? 5 : 8;
  const gap = size === 'sm' ? 4 : 6;

  const dots = (
    <View style={[styles.row, { gap }]}>
      <Dot delay={0} color={theme.app.primary} size={dotSize} />
      <Dot delay={150} color={theme.app.primary} size={dotSize} />
      <Dot delay={300} color={theme.app.primary} size={dotSize} />
    </View>
  );

  if (size === 'sm') return dots;
  return <View style={styles.container}>{dots}</View>;
}

const styles = StyleSheet.create({
  container: { paddingVertical: 32, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
});
