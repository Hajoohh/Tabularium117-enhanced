package alerts

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"sync"

	"github.com/Dealwatch/Tabularium117/internal/model"
)

// Suppression disables one alert rule for one island and product.
type Suppression struct {
	Island      model.IslandKey `json:"island"`
	ProductGUID int32           `json:"productGuid"`
	Rule        string          `json:"rule"`
}

// Preferences are the user-adjustable alert thresholds and rule suppressions.
type Preferences struct {
	DeficitThreshold     float64       `json:"deficitThreshold"`
	DropPercentagePoints float64       `json:"dropPercentagePoints"`
	Suppressions         []Suppression `json:"suppressions"`
}

// DefaultPreferences preserves the existing alert behavior.
func DefaultPreferences() Preferences {
	cfg := DefaultConfig()
	return Preferences{
		DeficitThreshold:     cfg.DeficitThreshold,
		DropPercentagePoints: cfg.DropPercentagePoints,
		Suppressions:         []Suppression{},
	}
}

type suppressionKey struct {
	island      model.IslandKey
	productGUID int32
	rule        string
}

// PreferenceManager validates and persists settings before applying them to
// the live rule engine.
type PreferenceManager struct {
	mu     sync.RWMutex
	path   string
	engine *Engine
	value  Preferences
}

// OpenPreferences loads preferences from path, or uses initial when no file
// exists. The effective values are immediately applied to engine.
func OpenPreferences(path string, initial Preferences, engine *Engine) (*PreferenceManager, error) {
	if engine == nil {
		return nil, errors.New("alerts: preference manager requires an engine")
	}
	value := initial
	data, err := os.ReadFile(path)
	if err == nil {
		if err := json.Unmarshal(data, &value); err != nil {
			return nil, fmt.Errorf("alerts: decode preferences %s: %w", path, err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("alerts: read preferences %s: %w", path, err)
	}
	value, err = normalizePreferences(value)
	if err != nil {
		return nil, fmt.Errorf("alerts: invalid preferences %s: %w", path, err)
	}
	manager := &PreferenceManager{path: path, engine: engine, value: value}
	engine.SetPreferences(value)
	return manager, nil
}

// Current returns a copy of the current preferences.
func (m *PreferenceManager) Current() Preferences {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return clonePreferences(m.value)
}

// Set writes preferences to disk before changing the live engine. A failed
// write leaves both the engine and the current preferences untouched.
func (m *PreferenceManager) Set(value Preferences) error {
	value, err := normalizePreferences(value)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.replaceLocked(value)
}

// SetThresholds changes both thresholds without overwriting a concurrent
// suppression update.
func (m *PreferenceManager) SetThresholds(deficit, drop float64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	value := clonePreferences(m.value)
	value.DeficitThreshold = deficit
	value.DropPercentagePoints = drop
	value, err := normalizePreferences(value)
	if err != nil {
		return err
	}
	return m.replaceLocked(value)
}

// SetSuppression adds or removes one rule suppression without overwriting
// concurrent changes to thresholds or other suppressions.
func (m *PreferenceManager) SetSuppression(suppression Suppression, disabled bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	value := clonePreferences(m.value)
	key := suppressionKey{
		island:      suppression.Island,
		productGUID: suppression.ProductGUID,
		rule:        suppression.Rule,
	}
	found := false
	for i, existing := range value.Suppressions {
		if (suppressionKey{
			island:      existing.Island,
			productGUID: existing.ProductGUID,
			rule:        existing.Rule,
		}) == key {
			found = true
			if !disabled {
				value.Suppressions = append(value.Suppressions[:i], value.Suppressions[i+1:]...)
			}
			break
		}
	}
	if disabled && !found {
		value.Suppressions = append(value.Suppressions, suppression)
	}
	value, err := normalizePreferences(value)
	if err != nil {
		return err
	}
	return m.replaceLocked(value)
}

func (m *PreferenceManager) replaceLocked(value Preferences) error {
	if err := writePreferences(m.path, value); err != nil {
		return err
	}
	m.engine.SetPreferences(value)
	m.value = value
	return nil
}

func normalizePreferences(value Preferences) (Preferences, error) {
	if math.IsNaN(value.DeficitThreshold) || math.IsInf(value.DeficitThreshold, 0) || value.DeficitThreshold > 0 {
		return Preferences{}, errors.New("deficitThreshold must be a finite number no greater than zero")
	}
	if math.IsNaN(value.DropPercentagePoints) || math.IsInf(value.DropPercentagePoints, 0) || value.DropPercentagePoints <= 0 {
		return Preferences{}, errors.New("dropPercentagePoints must be a finite positive number")
	}
	seen := make(map[suppressionKey]bool, len(value.Suppressions))
	for _, suppression := range value.Suppressions {
		if suppression.Rule != RuleDeficit && suppression.Rule != RuleNoLocalProduction && suppression.Rule != RuleProductivityDrop {
			return Preferences{}, fmt.Errorf("unknown alert rule %q", suppression.Rule)
		}
		key := suppressionKey{
			island:      suppression.Island,
			productGUID: suppression.ProductGUID,
			rule:        suppression.Rule,
		}
		if seen[key] {
			return Preferences{}, fmt.Errorf("duplicate suppression for island %d-%d product %d rule %q",
				key.island.SessionGUID, key.island.IslandID, key.productGUID, key.rule)
		}
		seen[key] = true
	}
	value.Suppressions = append([]Suppression(nil), value.Suppressions...)
	sort.Slice(value.Suppressions, func(i, j int) bool {
		a, b := value.Suppressions[i], value.Suppressions[j]
		if a.Island.SessionGUID != b.Island.SessionGUID {
			return a.Island.SessionGUID < b.Island.SessionGUID
		}
		if a.Island.IslandID != b.Island.IslandID {
			return a.Island.IslandID < b.Island.IslandID
		}
		if a.ProductGUID != b.ProductGUID {
			return a.ProductGUID < b.ProductGUID
		}
		return a.Rule < b.Rule
	})
	return value, nil
}

func clonePreferences(value Preferences) Preferences {
	value.Suppressions = append([]Suppression(nil), value.Suppressions...)
	return value
}

func writePreferences(path string, value Preferences) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Errorf("alerts: encode preferences: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("alerts: create preferences directory: %w", err)
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".alert-settings-*")
	if err != nil {
		return fmt.Errorf("alerts: create temporary preferences: %w", err)
	}
	tempPath := file.Name()
	defer os.Remove(tempPath)
	if err := file.Chmod(0o600); err != nil {
		file.Close()
		return fmt.Errorf("alerts: secure temporary preferences: %w", err)
	}
	if _, err := file.Write(data); err != nil {
		file.Close()
		return fmt.Errorf("alerts: write temporary preferences: %w", err)
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return fmt.Errorf("alerts: flush temporary preferences: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("alerts: close temporary preferences: %w", err)
	}
	if err := os.Rename(tempPath, path); err != nil {
		return fmt.Errorf("alerts: replace preferences %s: %w", path, err)
	}
	return nil
}
