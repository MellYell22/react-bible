import React from 'react';
import { View, StyleSheet } from 'react-native';

interface FullScreenBackgroundProps {
  children: React.ReactNode;
  center?: boolean;
}

export const FullScreenBackground: React.FC<FullScreenBackgroundProps> = ({ children, center = false }) => {
  return (
    <View style={[styles.container, center && styles.center]}>
      <View style={styles.safeArea}>
        {children}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b1e3d',
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  safeArea: {
    flex: 1,
  },
});
