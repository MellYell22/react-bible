import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { BibleTranslation } from '../types';

interface Props {
  value: BibleTranslation;
  onChange: (value: BibleTranslation) => void;
}

const TranslationPicker: React.FC<Props> = ({ value, onChange }) => {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{value}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  label: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: 'bold',
  },
});

export default TranslationPicker;
