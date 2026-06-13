use crate::data_provider::card_stats::{
    add_stat, delete_stat, load_stats_of_set, update_stat_score,
};

use crate::AppState;
use chrono::{DateTime, Utc};
use rand::distr::weighted::WeightedIndex;
use rand::distr::Distribution;
use rand::prelude::SliceRandom;
use rand::rng;
use rand::rngs::ThreadRng;
use serde::{Deserialize, Serialize};
use std::cmp::min;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

const MAX_HISTORY_LEN: usize = 20;
const MAX_HISTORY_LEN_PART: f32 = 0.33;
const MAX_SCORE: i32 = 25;
const FADE_PER_DAY: f32 = 0.95;


#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WordData {
    pub id: u32,
    pub key: String,
    pub value: String,
    pub tags: String,
    pub additional: HashMap<String, String>,
    pub group_id: u32,
}

impl WordData {
    pub fn new() -> Self {
        Self {
            id: 0,
            key: String::new(),
            value: String::new(),
            tags: String::new(),
            additional: Default::default(),
            group_id: 1,
        }
    }
}

#[derive(Clone)]
pub struct WordGroup {
    pub id: u32,
    pub name: String,
}

#[derive(Clone, PartialEq)]
pub struct CardStatistics {
    pub id: u32,
    pub word_id: u32,
    pub set_id: u32,
    pub last_open: DateTime<Utc>,
    pub score: i32,
}

impl CardStatistics {
    pub fn update(&mut self, status: WordOpenMode) {
        match status {
            WordOpenMode::Easy => {
                self.score = (self.calculated_score() + 5.0).round() as i32;
            }
            WordOpenMode::Ok => self.score = (self.calculated_score() + 2.0).round() as i32,
            WordOpenMode::Hard => {
                self.score = (self.calculated_score() - 1.0).round() as i32;
            }
            WordOpenMode::None => {
                self.score = (self.calculated_score() * 0.5) as i32;
            }
        }

        if self.score < 1 {
            self.score = 1
        } else if self.score > MAX_SCORE {
            self.score = MAX_SCORE
        }
        self.last_open = Utc::now();
    }

    pub fn calculated_score(&self) -> f32 {
        let time = Utc::now() - self.last_open;
        let days = time.num_days();
        let multiplier = FADE_PER_DAY.powi(days as i32);
        self.score as f32 * multiplier
    }
}

#[derive(Clone, Copy)]
pub enum WordOpenMode {
    Easy,
    Ok,
    Hard,
    None,
}

#[derive(Clone)]
pub struct CardSet {
    words: Vec<WordData>,
    set: Vec<CardStatistics>,
    current_word_index: Option<usize>,
    state: Arc<Mutex<AppState>>,
    order_module: OrderModule,
}

#[derive(Clone)]
pub struct CardSetSettings {
    pub id: u32,
    pub name: String,
    pub forward: String,
    pub backward: String,
    pub filter: String,
    pub count: Option<usize>,
    pub worst_words_list: Option<Vec<WordData>>,
    pub open_mode: SetOrderMode
}

impl CardSet {
    pub fn new(settings: &CardSetSettings, state: Arc<Mutex<AppState>>) -> Self {
        let state_for = state.clone();
        let state_locked = state.lock().unwrap();

        let mut current_set = load_stats_of_set(&settings, &state_locked.connection);
        let last_list = settings.get_word_list(&state_locked);
        let saved_ids = current_set.iter().map(|l| l.word_id).collect::<Vec<u32>>();
        let word_ids = last_list.iter().map(|l| l.id).collect::<Vec<u32>>();

        last_list
            .iter()
            .filter(|word| !saved_ids.contains(&word.id))
            .map(|word| CardStatistics {
                id: 0,
                word_id: word.id.clone(),
                last_open: Utc::now(),
                score: 1,
                set_id: settings.id.clone(),
            })
            .for_each(|mut new_statistic| {
                add_stat(&mut new_statistic, &state_locked.connection);
                current_set.push(new_statistic);
            });

        let mut index = 0;
        for stat in current_set.clone() {
            if !word_ids.contains(&stat.word_id) {
                delete_stat(&stat, &state_locked.connection);
                current_set.remove(index);
            } else {
                index += 1;
            }
        }

        Self {
            set: current_set,
            words: last_list,
            current_word_index: None,
            state: state_for,
            order_module: match settings.open_mode {
                SetOrderMode::Default => OrderModule::SemiRandomSRS(SemiRandomSRSModule::new()),
                SetOrderMode::TrainWorstFirst => {
                    OrderModule::WorstWordsSRS(WorstWordsSRSModule::new())
                }
                SetOrderMode::FullRandom => OrderModule::RandomSRS(RandomSRSModule::new()),
            },
        }
    }

    pub fn next(&mut self) -> (WordData, CardStatistics) {
        let index = match self.order_module.clone() {
            OrderModule::SemiRandomSRS(mut module) => {
                if module.initializated == false {
                    module.init(self)
                }
                let index = module.next(self);
                self.order_module = OrderModule::SemiRandomSRS(module);
                index
            }
            OrderModule::RandomSRS(mut module) => {
                if module.initializated == false {
                    module.init(self)
                }
                let index = module.next(self);
                self.order_module = OrderModule::RandomSRS(module);
                index
            }
            OrderModule::WorstWordsSRS(mut module) => {
                if module.initializated == false {
                    module.init(self)
                }
                let index = module.next(self);
                self.order_module = OrderModule::WorstWordsSRS(module);
                index
            }
        };

        self.current_word_index = Some(index);
        (self.words[index].clone(), self.set[index].clone())
    }

    pub fn open(&mut self, status: WordOpenMode) {
        if let None = self.current_word_index {
            return;
        }
        let index = self.current_word_index.unwrap();

        let word = &mut self.set[index];
        word.update(status);

        match self.order_module.clone() {
            OrderModule::SemiRandomSRS(mut module) => {
                module.open(status, index, word.clone());
                self.order_module = OrderModule::SemiRandomSRS(module);
            }
            OrderModule::RandomSRS(mut module) => {
                module.open(status, index, word.clone());
                self.order_module = OrderModule::RandomSRS(module);
            }
            OrderModule::WorstWordsSRS(mut module) => {
                module.open(status, index, word.clone());
                self.order_module = OrderModule::WorstWordsSRS(module);
            }
        }
        update_stat_score(word, &self.state.lock().unwrap().connection)
    }

    pub fn len(&self) -> usize {
        self.set.len()
    }
}

#[derive(Clone, PartialEq, Copy, Eq)]
pub(crate) enum SetOrderMode {
    Default,
    TrainWorstFirst,
    FullRandom,
}

#[derive(Clone)]
enum OrderModule {
    SemiRandomSRS(SemiRandomSRSModule),
    RandomSRS(RandomSRSModule),
    WorstWordsSRS(WorstWordsSRSModule),
}

trait SRSModule {
    fn next(&mut self, set: &mut CardSet) -> usize;
    fn open(&mut self, status: WordOpenMode, index: usize, updated_word: CardStatistics);
    fn init(&mut self, set: &mut CardSet);
}

#[derive(Clone)]
struct RandomSRSModule {
    backet: Vec<usize>,
    initializated: bool,
}

impl RandomSRSModule {
    fn new() -> RandomSRSModule {
        Self{
            backet: vec![],
            initializated: false,
        }
    }
}

impl SRSModule for RandomSRSModule {
    fn next(&mut self, set: &mut CardSet) -> usize {
        if self.backet.is_empty() {
            self.backet = (0..set.words.len()).collect::<Vec<usize>>();
            self.backet.shuffle(&mut rand::rng())
        }

        self.backet.pop().unwrap()
    }

    fn open(&mut self, _: WordOpenMode, _: usize, _: CardStatistics) {}

    fn init(&mut self, set: &mut CardSet) {
        self.initializated = true;
        self.backet = (0..set.words.len()).collect::<Vec<usize>>();
        self.backet.shuffle(&mut rand::rng())
    }
}

#[derive(Clone)]
struct SemiRandomSRSModule {
    history: Vec<usize>,
    last_weights: WeightedIndex<f32>,
    generator: ThreadRng,
    initializated: bool,
}

impl SemiRandomSRSModule {
    fn new() -> SemiRandomSRSModule {
        SemiRandomSRSModule {
            history: vec![],
            last_weights: WeightedIndex::new([1.0]).unwrap(),
            generator: rng(),
            initializated: false,
        }
    }
}

impl SRSModule for SemiRandomSRSModule {
    fn next(&mut self, set: &mut CardSet) -> usize {
        let index = self.last_weights.sample(&mut self.generator);

        if self.history.contains(&index) {
            return self.next(set);
        }

        if self.history.len() == self.history_len(set) {
            self.history.remove(0);
        }
        self.history.push(index);

        index
    }

    fn open(&mut self, status: WordOpenMode, index: usize, word: CardStatistics) {
        let new_weight = (100.0 / word.calculated_score()).powf(2.0);
        self.last_weights
            .update_weights(&[(index, &new_weight)])
            .unwrap();
    }

    fn init(&mut self, set: &mut CardSet) {
        self.initializated = true;
        let weights = set
            .set
            .iter()
            .map(|s| (100.0 / s.calculated_score()).powf(2.0) * 2.0)
            .collect::<Vec<f32>>();
        self.last_weights = WeightedIndex::new(weights).unwrap();
    }
}

impl SemiRandomSRSModule {
    fn history_len(&self, set: &CardSet) -> usize {
        min(
            MAX_HISTORY_LEN,
            (set.len() as f32 * MAX_HISTORY_LEN_PART) as usize,
        )
    }
}

#[derive(Clone)]
struct WorstWordsSRSModule {
    initializated: bool,
}

impl SRSModule for WorstWordsSRSModule {
    fn next(&mut self, set: &mut CardSet) -> usize {
        todo!()
    }

    fn open(&mut self, status: WordOpenMode, index: usize, updated_word: CardStatistics) {
        todo!()
    }

    fn init(&mut self, set: &mut CardSet) {
        todo!()
    }
}

impl WorstWordsSRSModule {
    fn new() -> WorstWordsSRSModule {
        WorstWordsSRSModule {
            initializated: false,
        }
    }
}
