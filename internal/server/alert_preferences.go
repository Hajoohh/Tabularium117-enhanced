package server

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"

	"github.com/Hajoohh/Tabularium117-enhanced/internal/alerts"
	"github.com/Hajoohh/Tabularium117-enhanced/internal/model"
)

const (
	alertPreferencesPath = "/api/v1/alert-settings"
	maxAlertSettingsBody = 16 << 10
)

type alertSuppressionDTO struct {
	IslandID    string `json:"islandId"`
	IslandName  string `json:"islandName"`
	ProductGUID int32  `json:"productGuid"`
	ProductName string `json:"productName"`
	Rule        string `json:"rule"`
}

type alertPreferencesDTO struct {
	DeficitThreshold     float64               `json:"deficitThreshold"`
	DropPercentagePoints float64               `json:"dropPercentagePoints"`
	Suppressions         []alertSuppressionDTO `json:"suppressions"`
}

type alertPreferencesRequest struct {
	DeficitThreshold     *float64 `json:"deficitThreshold"`
	DropPercentagePoints *float64 `json:"dropPercentagePoints"`
	IslandID             string   `json:"islandId"`
	ProductGUID          *int32   `json:"productGuid"`
	Rule                 string   `json:"rule"`
	Disabled             *bool    `json:"disabled"`
}

func (s *Server) handleAlertPreferences(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		writeJSON(w, http.StatusOK, s.preferencesResponse(r))
		return
	}
	if r.Method == http.MethodHead {
		w.Header().Set("Content-Type", contentTypeJSON)
		w.WriteHeader(http.StatusOK)
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "GET, HEAD, POST")
		writeError(w, http.StatusMethodNotAllowed, "use GET, HEAD or POST")
		return
	}
	if !isLocal(r) {
		writeError(w, http.StatusForbidden, "alert settings can only be changed on this PC")
		return
	}
	if !s.originAllowed(r) {
		s.log.Warn("refused alert-settings write with a foreign origin", "origin", r.Header.Get("Origin"))
		writeError(w, http.StatusForbidden, "the request must come from this Tabularium 117 page")
		return
	}
	if s.alertPreferences == nil {
		writeError(w, http.StatusServiceUnavailable, "alert settings are not available")
		return
	}
	if contentType(r) != "application/json" {
		writeError(w, http.StatusUnsupportedMediaType, "Content-Type must be application/json")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxAlertSettingsBody)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var input alertPreferencesRequest
	if err := decoder.Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid alert settings: "+err.Error())
		return
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		writeError(w, http.StatusBadRequest, "invalid alert settings: expected one JSON object")
		return
	}

	thresholds := input.DeficitThreshold != nil || input.DropPercentagePoints != nil
	suppression := input.ProductGUID != nil || input.Disabled != nil || input.IslandID != "" || input.Rule != ""
	var err error
	switch {
	case thresholds && !suppression && input.DeficitThreshold != nil && input.DropPercentagePoints != nil:
		if math.IsNaN(*input.DeficitThreshold) || math.IsInf(*input.DeficitThreshold, 0) || *input.DeficitThreshold > 0 {
			writeError(w, http.StatusBadRequest, "deficitThreshold must be a finite number no greater than zero")
			return
		}
		if math.IsNaN(*input.DropPercentagePoints) || math.IsInf(*input.DropPercentagePoints, 0) || *input.DropPercentagePoints <= 0 {
			writeError(w, http.StatusBadRequest, "dropPercentagePoints must be a finite positive number")
			return
		}
		err = s.alertPreferences.SetThresholds(*input.DeficitThreshold, *input.DropPercentagePoints)
	case !thresholds && suppression && input.ProductGUID != nil && input.Disabled != nil && input.IslandID != "" && input.Rule != "":
		key, ok := parseIslandID(input.IslandID)
		if !ok {
			writeError(w, http.StatusBadRequest, "islandId must identify an island")
			return
		}
		if *input.ProductGUID <= 0 {
			writeError(w, http.StatusBadRequest, "productGuid must be positive")
			return
		}
		if input.Rule != alerts.RuleDeficit && input.Rule != alerts.RuleNoLocalProduction && input.Rule != alerts.RuleProductivityDrop {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("unknown alert rule %q", input.Rule))
			return
		}
		err = s.alertPreferences.SetSuppression(alerts.Suppression{
			Island:      key,
			ProductGUID: *input.ProductGUID,
			Rule:        input.Rule,
		}, *input.Disabled)
	default:
		writeError(w, http.StatusBadRequest, "provide both thresholds or one complete suppression update")
		return
	}
	if err != nil {
		s.log.Error("cannot persist alert settings", "error", err)
		writeError(w, http.StatusInternalServerError, "cannot save alert settings")
		return
	}
	writeJSON(w, http.StatusOK, s.preferencesResponse(r))
}

func (s *Server) preferencesResponse(r *http.Request) alertPreferencesDTO {
	value := alerts.DefaultPreferences()
	if s.alertPreferences != nil {
		value = s.alertPreferences.Current()
	}
	islands := make(map[model.IslandKey]string)
	for _, snapshot := range s.state.Islands() {
		islands[snapshot.Key] = strings.TrimSpace(snapshot.Name)
	}
	out := alertPreferencesDTO{
		DeficitThreshold:     value.DeficitThreshold,
		DropPercentagePoints: value.DropPercentagePoints,
		Suppressions:         make([]alertSuppressionDTO, 0, len(value.Suppressions)),
	}
	lang := s.language(r)
	for _, suppression := range value.Suppressions {
		name := islands[suppression.Island]
		if name == "" {
			name = islandID(suppression.Island)
		}
		out.Suppressions = append(out.Suppressions, alertSuppressionDTO{
			IslandID:    islandID(suppression.Island),
			IslandName:  name,
			ProductGUID: suppression.ProductGUID,
			ProductName: s.catalog.Name(suppression.ProductGUID, lang),
			Rule:        suppression.Rule,
		})
	}
	return out
}
