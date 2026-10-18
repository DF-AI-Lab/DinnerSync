package com.dfailab.dinnersync.beta;

import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DinnerAlarmsPlugin.class);
        super.onCreate(savedInstanceState);
        // The alarm's full-screen notification opens this over the lock screen.
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
    }
}
