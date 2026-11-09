package main

import (
	"strings"
	"testing"
)

func TestGenerateBuildsCompleteChainsAndRetainsAlternatives(t *testing.T) {
	input := &params{
		Products: []product{{GUID: 1}, {GUID: 2}, {GUID: 3}, {GUID: 4}},
		ProductFilters: []productFilter{{
			LocaText: map[string]string{"english": "Consumer Goods"},
			Products: []int32{3, 4},
		}},
		Regions: []region{{
			ID:       "Roman",
			LocaText: map[string]string{"english": "Latium"},
		}},
		Factories: []factory{
			{GUID: 10, Regions: []string{"Roman"}, Inputs: []amount{{Product: 1}}, Outputs: []amount{{Product: 2}}},
			{GUID: 11, Regions: []string{"Roman"}, Inputs: []amount{{Product: 1}}, Outputs: []amount{{Product: 2}}},
			{GUID: 20, Regions: []string{"Roman"}, Inputs: []amount{{Product: 1}}, Outputs: []amount{{Product: 3}}},
			{GUID: 30, Regions: []string{"Roman"}, Inputs: []amount{{Product: 2}, {Product: 3}}, Outputs: []amount{{Product: 4}}},
			{GUID: 40, Regions: []string{"Roman"}, Outputs: []amount{{Product: 1}}},
		},
	}

	got, err := generate(input)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.EndProducts) != 2 || got.EndProducts[0] != 3 || got.EndProducts[1] != 4 {
		t.Fatalf("end products = %v, want sorted consumer product GUIDs [3 4]", got.EndProducts)
	}
	chains := got.Regions["Latium"]
	if len(chains) != 5 {
		t.Fatalf("got %d chains, want 5 (including both ways to make product 2)", len(chains))
	}
	var final *chain
	for index := range chains {
		if chains[index].Product.GUID == 4 {
			final = &chains[index]
			break
		}
	}
	if final == nil {
		t.Fatal("missing chain for product 4")
	}
	if len(final.Stages) != 3 {
		t.Fatalf("final chain has %d stages, want 3", len(final.Stages))
	}
	if final.Stages[0].Output.GUID != 2 || final.Stages[1].Output.GUID != 3 || final.Stages[2].Output.GUID != 4 {
		t.Fatalf("stages are not in production order: %+v", final.Stages)
	}
}

func TestGenerateRejectsUnknownProductsAndCycles(t *testing.T) {
	base := &params{
		Products: []product{{GUID: 1}, {GUID: 2}},
		ProductFilters: []productFilter{{
			LocaText: map[string]string{"english": "Consumer Goods"},
			Products: []int32{1},
		}},
		Regions: []region{{
			ID:       "Roman",
			LocaText: map[string]string{"english": "Latium"},
		}},
	}

	unknown := *base
	unknown.Factories = []factory{{
		GUID: 10, Regions: []string{"Roman"}, Inputs: []amount{{Product: 9}}, Outputs: []amount{{Product: 2}},
	}}
	if _, err := generate(&unknown); err == nil || !strings.Contains(err.Error(), "unknown product 9") {
		t.Fatalf("unknown product error = %v", err)
	}

	cyclic := *base
	cyclic.Factories = []factory{
		{GUID: 10, Regions: []string{"Roman"}, Inputs: []amount{{Product: 2}}, Outputs: []amount{{Product: 1}}},
		{GUID: 20, Regions: []string{"Roman"}, Inputs: []amount{{Product: 1}}, Outputs: []amount{{Product: 2}}},
	}
	if _, err := generate(&cyclic); err == nil || !strings.Contains(err.Error(), "production cycle") {
		t.Fatalf("cycle error = %v", err)
	}
}

func TestReadParamsAcceptsCalculatorPrefix(t *testing.T) {
	input := []byte(`if(window.params == null)window.params={"factories":[],"products":[],"productFilters":[],"regions":[]};`)
	parsed, err := readParams(input)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Factories == nil || parsed.Products == nil || parsed.Regions == nil {
		t.Fatalf("expected empty arrays, got %+v", parsed)
	}
}
