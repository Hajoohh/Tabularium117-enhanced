package server_test

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/Dealwatch/Tabularium117/internal/alerts"
	"github.com/Dealwatch/Tabularium117/internal/server"
	"github.com/Dealwatch/Tabularium117/internal/state"
)

type failingAlertPreferences struct{}

func (failingAlertPreferences) Current() alerts.Preferences {
	return alerts.DefaultPreferences()
}

func (failingAlertPreferences) SetThresholds(float64, float64) error {
	return errors.New("disk full")
}

func (failingAlertPreferences) SetSuppression(alerts.Suppression, bool) error {
	return errors.New("disk full")
}

func TestAlertPreferencesEndpoint(t *testing.T) {
	engine := alerts.New(alerts.DefaultConfig())
	manager, err := alerts.OpenPreferences(filepath.Join(t.TempDir(), "alert-settings.json"), alerts.DefaultPreferences(), engine)
	if err != nil {
		t.Fatal(err)
	}
	srv := server.New(server.Options{
		State:            state.New(),
		Alerts:           engine,
		AlertPreferences: manager,
	})

	post := func(body, origin string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/alert-settings", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		response := httptest.NewRecorder()
		srv.Handler().ServeHTTP(response, req)
		return response
	}

	response := post(`{"deficitThreshold":-1.25,"dropPercentagePoints":15}`, "http://localhost")
	if response.Code != http.StatusOK {
		t.Fatalf("threshold update status = %d: %s", response.Code, response.Body.String())
	}
	response = post(`{"islandId":"3245-1","productGuid":42,"rule":"deficit","disabled":true}`, "http://localhost")
	if response.Code != http.StatusOK {
		t.Fatalf("suppression update status = %d: %s", response.Code, response.Body.String())
	}
	var got struct {
		DeficitThreshold     float64 `json:"deficitThreshold"`
		DropPercentagePoints float64 `json:"dropPercentagePoints"`
		Suppressions         []struct {
			IslandID    string `json:"islandId"`
			ProductGUID int32  `json:"productGuid"`
			Rule        string `json:"rule"`
		} `json:"suppressions"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.DeficitThreshold != -1.25 || got.DropPercentagePoints != 15 {
		t.Errorf("settings thresholds = %v/%v", got.DeficitThreshold, got.DropPercentagePoints)
	}
	if len(got.Suppressions) != 1 || got.Suppressions[0].IslandID != "3245-1" ||
		got.Suppressions[0].ProductGUID != 42 || got.Suppressions[0].Rule != alerts.RuleDeficit {
		t.Errorf("suppressions = %+v", got.Suppressions)
	}

	response = post(`{"islandId":"3245-1","productGuid":42,"rule":"deficit","disabled":false}`, "http://localhost")
	if response.Code != http.StatusOK || len(manager.Current().Suppressions) != 0 {
		t.Fatalf("reactivating rule status/settings = %d/%+v", response.Code, manager.Current())
	}

	head := httptest.NewRequest(http.MethodHead, "/api/v1/alert-settings", nil)
	headResponse := httptest.NewRecorder()
	srv.Handler().ServeHTTP(headResponse, head)
	if headResponse.Code != http.StatusOK || headResponse.Body.Len() != 0 {
		t.Fatalf("HEAD status/body = %d/%q", headResponse.Code, headResponse.Body.String())
	}
}

func TestAlertPreferencesEndpointReportsPersistenceErrors(t *testing.T) {
	srv := server.New(server.Options{
		State:            state.New(),
		AlertPreferences: failingAlertPreferences{},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/alert-settings",
		strings.NewReader(`{"deficitThreshold":-1,"dropPercentagePoints":20}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://localhost")
	response := httptest.NewRecorder()
	srv.Handler().ServeHTTP(response, req)
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusInternalServerError, response.Body.String())
	}
}

func TestAlertPreferencesEndpointRejectsInvalidWrites(t *testing.T) {
	engine := alerts.New(alerts.DefaultConfig())
	manager, err := alerts.OpenPreferences(filepath.Join(t.TempDir(), "alert-settings.json"), alerts.DefaultPreferences(), engine)
	if err != nil {
		t.Fatal(err)
	}
	srv := server.New(server.Options{State: state.New(), AlertPreferences: manager})
	for _, tc := range []struct {
		name        string
		body        string
		contentType string
		origin      string
		want        int
	}{
		{"positive deficit threshold", `{"deficitThreshold":1,"dropPercentagePoints":20}`, "application/json", "http://localhost", http.StatusBadRequest},
		{"zero productivity threshold", `{"deficitThreshold":0,"dropPercentagePoints":0}`, "application/json", "http://localhost", http.StatusBadRequest},
		{"unknown rule", `{"islandId":"3245-1","productGuid":42,"rule":"other","disabled":true}`, "application/json", "http://localhost", http.StatusBadRequest},
		{"non-positive product guid", `{"islandId":"3245-1","productGuid":0,"rule":"deficit","disabled":true}`, "application/json", "http://localhost", http.StatusBadRequest},
		{"malformed JSON", `{"deficitThreshold":`, "application/json", "http://localhost", http.StatusBadRequest},
		{"missing content type", `{"deficitThreshold":-1,"dropPercentagePoints":20}`, "", "http://localhost", http.StatusUnsupportedMediaType},
		{"foreign content type", `{"deficitThreshold":-1,"dropPercentagePoints":20}`, "text/plain", "http://localhost", http.StatusUnsupportedMediaType},
		{"oversized JSON", `{"deficitThreshold":-1,"dropPercentagePoints":20}` + strings.Repeat(" ", 16<<10), "application/json", "http://localhost", http.StatusBadRequest},
		{"foreign origin", `{"deficitThreshold":-1,"dropPercentagePoints":20}`, "application/json", "http://evil.example", http.StatusForbidden},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := manager.Current()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/alert-settings", strings.NewReader(tc.body))
			if tc.contentType != "" {
				req.Header.Set("Content-Type", tc.contentType)
			}
			req.Header.Set("Origin", tc.origin)
			response := httptest.NewRecorder()
			srv.Handler().ServeHTTP(response, req)
			if response.Code != tc.want {
				t.Errorf("status = %d, want %d: %s", response.Code, tc.want, response.Body.String())
			}
			if after := manager.Current(); !reflect.DeepEqual(after, before) {
				t.Errorf("rejected write changed settings: before=%+v after=%+v", before, after)
			}
		})
	}
}
