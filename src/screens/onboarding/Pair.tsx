import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';

const HEADBAND = require('../../../assets/images/headband.png');
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { SerifDisplay, Body, Eyebrow } from '../../theme/typography';
import { colors, layout, spacing } from '../../theme/tokens';
import { useSession } from '../../state/session';
import { bleClient, type FoundDevice } from '../../lib/ble';
import type { OnboardingStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Pair'>;

type PairState = 'scanning' | 'found' | 'pairing' | 'paired';

export function Pair({ navigation }: Props) {
  const setPaired = useSession((s) => s.setPaired);
  const [state, setState] = useState<PairState>('scanning');
  const [device, setDevice] = useState<FoundDevice | null>(null);

  useEffect(() => {
    const stop = bleClient.scan((found) => {
      setDevice(found);
      setState('found');
    });
    return stop;
  }, []);

  const confirm = async () => {
    if (!device) return;
    setState('pairing');
    // Pairing happens implicitly on first connect — we connect once here to
    // confirm the device is reachable, then drop the connection. Real flows
    // (overnight pull) will connect again when needed.
    const connection = await bleClient.connect(device.deviceId);
    await connection.disconnect();
    setPaired(device.serial);
    setState('paired');
    setTimeout(() => navigation.navigate('HowItWorks'), 700);
  };

  const skip = () => {
    setPaired(null);
    navigation.navigate('HowItWorks');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.center}>
        <Image
          source={HEADBAND}
          style={styles.deviceImage}
          resizeMode="contain"
        />

        <SerifDisplay style={styles.headline}>Pair your headband</SerifDisplay>
        <Body style={styles.subtext}>
          Hold the button on your headband for 4 seconds until the light pulses.
        </Body>

        <Card style={styles.card}>
          {state === 'scanning' ? (
            <View style={styles.row}>
              <ActivityIndicator color={colors.textSecondary} />
              <Body style={styles.cardText}>Searching for your headband…</Body>
            </View>
          ) : null}

          {state === 'found' && device ? (
            <View style={styles.foundCol}>
              <Eyebrow>found</Eyebrow>
              <Body style={styles.deviceSerial}>{device.serial}</Body>
            </View>
          ) : null}

          {state === 'pairing' ? (
            <View style={styles.row}>
              <ActivityIndicator color={colors.textSecondary} />
              <Body style={styles.cardText}>Connecting…</Body>
            </View>
          ) : null}

          {state === 'paired' ? (
            <View style={styles.foundCol}>
              <Eyebrow>connected</Eyebrow>
              <Body style={styles.deviceSerial}>{device?.serial}</Body>
            </View>
          ) : null}
        </Card>
      </View>

      <View style={styles.actions}>
        <Button
          label="confirm"
          onPress={confirm}
          disabled={state !== 'found'}
          loading={state === 'pairing'}
        />
        <Button label="skip for now" variant="ghost" onPress={skip} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
    paddingHorizontal: layout.screenPadding,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deviceImage: {
    width: '100%',
    height: 180,
    marginBottom: spacing.xl,
  },
  headline: {
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  subtext: {
    color: colors.textSecondary,
    marginBottom: spacing.xl,
    textAlign: 'center',
  },
  card: {
    minHeight: 100,
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  cardText: {
    color: colors.textSecondary,
  },
  foundCol: {
    gap: spacing.sm,
  },
  deviceSerial: {
    fontSize: 18,
  },
  actions: {
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
});
