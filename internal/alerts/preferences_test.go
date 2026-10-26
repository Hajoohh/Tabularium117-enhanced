package alerts_test

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/Hajoohh/Tabularium117-enhanced/internal/alerts"
	"github.com/Hajoohh/Tabularium117-enhanced/internal/model"
)

func TestPreferenceManagerPersistsThresholdsAndSuppressions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "alert-settings.json")
	engine := alerts.New(alerts.DefaultConfig())
	manager, err := alerts.OpenPreferences(path, alerts.DefaultPreferences(), engine)
	if err != nil {
		t.Fatal(err)
	}
	suppression := alerts.Suppression{
		Island:      model.IslandKey{SessionGUID: 3245, IslandID: 1},
		ProductGUID: 2068,
		Rule:        alerts.RuleDeficit,
	}
	if err := manager.SetSuppression(suppression, true); err != nil {
		t.Fatal(err)
	}
	if err := manager.SetThresholds(-1.25, 17.5); err != nil {
		t.Fatal(err)
	}

	reopenedEngine := alerts.New(alerts.DefaultConfig())
	reopened, err := alerts.OpenPreferences(path, alerts.DefaultPreferences(), reopenedEngine)
	if err != nil {
		t.Fatal(err)
	}
	got := reopened.Current()
	if got.DeficitThreshold != -1.25 || got.DropPercentagePoints != 17.5 {
		t.Errorf("thresholds = %v/%v, want -1.25/17.5", got.DeficitThreshold, got.DropPercentagePoints)
	}
	if len(got.Suppressions) != 1 || got.Suppressions[0] != suppression {
		t.Errorf("suppressions = %+v, want %+v", got.Suppressions, suppression)
	}
	if cfg := reopenedEngine.Config(); cfg.DeficitThreshold != -1.25 || cfg.DropPercentagePoints != 17.5 {
		t.Errorf("engine config = %+v, preferences were not applied", cfg)
	}
}

func TestDeficitThresholdAndPerRuleSuppression(t *testing.T) {
	e := alerts.New(alerts.Config{DeficitSamples: 1})
	preferences := alerts.Preferences{
		DeficitThreshold:     -1,
		DropPercentagePoints: 20,
		Suppressions:         []alerts.Suppression{},
	}
	e.SetPreferences(preferences)
	if events := e.Apply(snapshot(time.Second, delta(-0.5))); len(events) != 0 {
		t.Fatalf("delta above threshold raised events: %v", events)
	}
	events := e.Apply(snapshot(2*time.Second, delta(-1.5)))
	if len(events) != 1 || events[0].Kind != alerts.KindRaised || events[0].Alert.Rule != alerts.RuleDeficit {
		t.Fatalf("delta below threshold produced %v, want a deficit warning", events)
	}

	key := alerts.Suppression{
		Island:      model.IslandKey{SessionGUID: island, IslandID: 5},
		ProductGUID: product,
		Rule:        alerts.RuleDeficit,
	}
	preferences.Suppressions = []alerts.Suppression{key}
	e.SetPreferences(preferences)
	events = e.Apply(snapshot(3*time.Second, delta(-2)))
	if len(events) != 1 || events[0].Kind != alerts.KindCleared {
		t.Fatalf("disabled active warning produced %v, want it cleared on the next sample", events)
	}
	if active := e.Active(); len(active) != 0 {
		t.Fatalf("active alerts after suppression = %v, want none", active)
	}

	preferences.Suppressions = nil
	e.SetPreferences(preferences)
	events = e.Apply(snapshot(4*time.Second, delta(-2)))
	if len(events) != 1 || events[0].Kind != alerts.KindRaised {
		t.Fatalf("reenabled rule produced %v, want a warning when its condition still holds", events)
	}
}

func TestDeficitThresholdBoundaryAndRecovery(t *testing.T) {
	e := alerts.New(alerts.Config{DeficitSamples: 2, DeficitClearSamples: 2})
	e.SetPreferences(alerts.Preferences{
		DeficitThreshold:     -1,
		DropPercentagePoints: 20,
	})

	for i, value := range []float32{-1, -1} {
		if events := e.Apply(snapshot(time.Duration(i)*time.Second, delta(value))); len(events) != 0 {
			t.Fatalf("delta equal to threshold raised at sample %d: %v", i, events)
		}
	}
	for i, value := range []float32{-1.01, -1.01} {
		events := e.Apply(snapshot(time.Duration(i+2)*time.Second, delta(value)))
		if i == 0 && len(events) != 0 {
			t.Fatalf("first delta below threshold raised early: %v", events)
		}
		if i == 1 && (len(events) != 1 || events[0].Kind != alerts.KindRaised) {
			t.Fatalf("second delta below threshold produced %v, want one raised warning", events)
		}
	}

	for i := range 2 {
		events := e.Apply(snapshot(time.Duration(i+4)*time.Second, delta(-1)))
		if i == 0 && (len(events) != 0 || len(e.Active()) != 1) {
			t.Fatalf("one sample at the threshold cleared the warning: events=%v active=%v", events, e.Active())
		}
		if i == 1 && (len(events) != 1 || events[0].Kind != alerts.KindCleared) {
			t.Fatalf("second sample at the threshold produced %v, want one cleared warning", events)
		}
	}
}

func TestSuppressingOneWarningRuleLeavesOtherRulesActive(t *testing.T) {
	for _, tc := range []struct {
		name          string
		suppressed    string
		otherRule     string
		wantFirstTick bool
	}{
		{
			name:          "suppress deficit but keep productivity drop",
			suppressed:    alerts.RuleDeficit,
			otherRule:     alerts.RuleProductivityDrop,
			wantFirstTick: false,
		},
		{
			name:          "suppress productivity drop but keep deficit",
			suppressed:    alerts.RuleProductivityDrop,
			otherRule:     alerts.RuleDeficit,
			wantFirstTick: true,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := alerts.New(alerts.Config{
				DeficitSamples:       1,
				DropNegativeSamples:  2,
				DropWindow:           15 * time.Minute,
				MinSamplesForDrop:    3,
				DropPercentagePoints: 20,
			})
			e.SetPreferences(alerts.Preferences{
				DeficitThreshold:     0,
				DropPercentagePoints: 20,
				Suppressions: []alerts.Suppression{{
					Island:      model.IslandKey{SessionGUID: island, IslandID: 5},
					ProductGUID: product,
					Rule:        tc.suppressed,
				}},
			})

			first := e.Apply(snapshot(0, productivity(80)))
			if tc.wantFirstTick {
				if len(first) != 1 || first[0].Alert.Rule != tc.otherRule || first[0].Kind != alerts.KindRaised {
					t.Fatalf("first tick produced %v, want an unsuppressed %s warning", first, tc.otherRule)
				}
			} else if len(first) != 0 {
				t.Fatalf("suppressed deficit produced events on first tick: %v", first)
			}

			for i, value := range []float32{80, 80, 50} {
				events := e.Apply(snapshot(time.Duration(i+1)*2*time.Minute, productivity(value)))
				wantDropRaise := tc.suppressed == alerts.RuleDeficit && value == 50
				if wantDropRaise {
					if len(events) != 1 || events[0].Kind != alerts.KindRaised ||
						events[0].Alert.Rule != alerts.RuleProductivityDrop {
						t.Fatalf("final tick produced %v, want one unsuppressed productivity warning", events)
					}
				} else if len(events) != 0 {
					t.Fatalf("tick %d produced %v, want no new event", i, events)
				}
			}

			activeRules := make(map[string]bool)
			for _, alert := range e.Active() {
				activeRules[alert.Rule] = true
			}
			if !activeRules[tc.otherRule] {
				t.Errorf("unsuppressed rule %q is not active; active rules are %v", tc.otherRule, activeRules)
			}
			if activeRules[tc.suppressed] {
				t.Errorf("suppressed rule %q is active", tc.suppressed)
			}
		})
	}
}

func TestNoLocalProductionCanBeSuppressedSeparately(t *testing.T) {
	e := alerts.New(alerts.Config{DeficitSamples: 1})
	e.SetPreferences(alerts.Preferences{
		DeficitThreshold:     0,
		DropPercentagePoints: 20,
		Suppressions: []alerts.Suppression{{
			Island:      model.IslandKey{SessionGUID: island, IslandID: 5},
			ProductGUID: product,
			Rule:        alerts.RuleNoLocalProduction,
		}},
	})
	if events := e.Apply(snapshot(time.Second, imported(-2))); len(events) != 0 {
		t.Fatalf("suppressed import rule produced %v", events)
	}
	events := e.Apply(snapshot(2*time.Second, delta(-2)))
	if len(events) != 1 || events[0].Alert.Rule != alerts.RuleDeficit {
		t.Fatalf("deficit rule was also suppressed: %v", events)
	}
}
