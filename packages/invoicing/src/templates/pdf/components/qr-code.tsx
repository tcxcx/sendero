import { Image, StyleSheet, View } from '@react-pdf/renderer';
import { theme } from '../theme';

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: theme.spacing(4),
  },
  img: {
    width: 72,
    height: 72,
    padding: 4,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
});

export function QRCode({ dataUrl }: { dataUrl: string }) {
  if (!dataUrl) return null;
  return (
    <View style={styles.container}>
      <Image src={dataUrl} style={styles.img} />
    </View>
  );
}
