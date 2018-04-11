
/*Helper class for loading historical data from ethereum contract variables.
  Initialize with an ethjs object, target contract address, and an integer 
  index that points to your desired variable in in the contract's storage area

  obj.addValueAtEthBlock(<block number>) starts a request to fetch
  and cache the value of your variable at that time. Note if you pass a
  non-integer block number it will be rounded.
  
  obj.areAllValuesLoaded() will return true once all fetches are complete

  obj.getValues returns all requested data
 */
class contractValueOverTime {
  constructor(eth, contract_address, storage_index) {
    this.eth = eth;
    this.contract_address = contract_address;
    this.storage_index = storage_index;
    this.sorted = false;
    this.states = [];
    /* since values are added asynchronously, we store the length we
    expect state to be once all values are pushed */
    this.expected_state_length = 0;
  }
  get getValues() {
    return this.states;
  }
  printValuesToLog() {
    this.states.forEach((value) => {
      log('block #', value[0], 'ts', value[2], 'value[1]:', (value[1]).toString(10));
    });
  }
  /* fetch query_count states between start_block_num and end_block_num */
  addValuesInRange(start_block_num, end_block_num, query_count) {
    var stepsize = (end_block_num-start_block_num) / query_count;

    for (var count = 0; count < query_count; count += 1) {
      this.addValueAtEthBlock(end_block_num - (stepsize*count));
    }
  }
  addValueAtEthBlock(eth_block_num) {
    /* read value from contract @ specific block num, save to this.states

       detail: load eth provider with a request to load value from 
       block @ num. Callback is anonymous function which pushes the 
       value onto this.states */
    this.expected_state_length += 1;
    this.sorted = false;

    /* make sure we only request integer blocks */
    eth_block_num = Math.round(eth_block_num)

    log('requested', this.storage_index, '@ block', eth_block_num)

    var saveState = function(block_states, eth_block_num) {
      return function (value) {
        /* TODO: probably a way to convert w/o going through hex_str */
        //log('value:', value)
        var hex_str = value.substr(2, 64);
        var value_bn = new Eth.BN(hex_str, 16)
        // var difficulty = max_target.div(value_bn)

        // console.log("Block #", eth_block_num, ":", value);
        // log("Block #", eth_block_num, ":", difficulty.toString(10));

        /* [block num, value @ block num, timestamp of block num] */
        var len = block_states.push([eth_block_num, value_bn, '']);

        function setValue(save_fn) {
          return function(value) {
            save_fn(value);
          }
        }

        /* TODO: uncomment this to use timestamps embedded in block */
        // eth.getBlockByNumber(eth_block_num, true).then(setValue((value)=>{block_states[len-1][2]=value.timestamp.toString(10)}))

      }
    }
    this.eth.getStorageAt(this.contract_address, 
                          new Eth.BN(this.storage_index, 10),
                          eth_block_num.toString(10))
    .then(
      saveState(this.states, eth_block_num)
    ).catch((error) => {
      log('error reading block storage:', error);
    });
  }
  areAllValuesLoaded() {
    return this.expected_state_length == this.states.length;
  }
  async waitUntilLoaded() {
    while (!this.areAllValuesLoaded()) {
      //log('waiting for values to load...');
      await sleep(80);
    }
  }
  // onAllValuesLoaded(callback) {
  //   this.on_all_values_loaded_callback = callback;
  // }
  sortValues() {
    log('sorting values..');
    this.states.sort((a, b) => {
      //log('a', a[0], 'b', b[0]);
      return a[0] - b[0];
    });
    this.sorted = true;
  }
  /* iterate through already loaded values. Wherever a state change is
  seen, queue another value load from the blockchain halfway between 
  state A and state B. Goal is to get closer to the actual eth block
  number where the state transition occurs. */
  increaseTransitionResolution() {
    if(!this.sorted) {
      this.sortValues();
    }

    var last_block_number = this.states[0][0];
    var last_value = this.states[0][1];
    for(var i = 0; i < this.states.length; i++) {
      var block_number = this.states[i][0];
      var value = this.states[i][1];
      if(last_value.cmp(value) != 0) {
        this.addValueAtEthBlock(((last_block_number + block_number)/2));
      }
      last_value = value;
      last_block_number = block_number;
    }
  }
  /* iterate through already loaded values. If 3 or more repeating
  values are detected, remove all middle values so only the first and
  last state with that value remain  */
  deduplicate() {
    if(!this.sorted) {
      this.sortValues();
    }
    /* we actually go backwards so we don't screw up array indexing
    as we remove values along the way */
    for(var i = this.states.length-1; i >= 2 ; i--) {
      var v1 = this.states[i][1];
      var v2 = this.states[i-1][1];
      var v3 = this.states[i-2][1];

      if (v1.cmp(v2) == 0
          && v2.cmp(v3) == 0) {
        /* remove one item at location i-1 (middle value) */
        this.states.splice(i-1, 1);
      }
    }
  }
  /* iterate through already loaded values. If 2 or more repeating values are
     detected, remove all but the first block where that value is seen. */
  removeExtraValuesForStepChart(allow_last_value) {
    if(allow_last_value == undefined) {
      allow_last_value = true;
    }
    if(allow_last_value) {
      var start_index = this.states.length-2;
    } else {
      var start_index = this.states.length-1;
    }
    if(!this.sorted) {
      this.sortValues();
    }
    /* we actually go backwards so we don't screw up array indexing
    as we remove values along the way */
    for(var i = start_index; i >= 1 ; i--) {
      var v1 = this.states[i][1];
      var v2 = this.states[i-1][1];

      if (v1.cmp(v2) == 0) {
        /* remove one item at location i (first value) */
        this.states.splice(i, 1);
      }
    }
  }
}


function showDifficultyGraph(chart_data) {
  var colors = [
    'rgb(156, 204, 101)', // green
    'rgb(239,  83,  80)', // red
    'rgb( 41, 182, 246)', // light blue
    'rgb( 38, 166, 154)', // teal
    'rgb(126,  87, 194)', // purple
    'rgb(255, 238,  88)', // yellow
    'rgb(236,  64, 122)', // pink
    'rgb(189, 189, 189)', // grey
    'rgb(141, 110,  99)', // brown
    'rgb(255, 167,  38)', // orange

  ]

  var datasets = [];
  for (var i = 0; i < chart_data.length; i++) {
    datasets.push({
      label: chart_data[i].name,
      showLine: true,
      backgroundColor: colors[i],
      borderColor: colors[i],
      data: chart_data[i].data,
      fill: false,
      yAxisID: 'first-y-axis',
    });
  }

  /* this function interprets tooltop events and displays html in response */
  var customTooltips = function(tooltip) {
      var y_position_offset = 28;  // how many px to move down overlapped tooltips
      $(this._chart.canvas).css('cursor', 'pointer');

      var positionY = this._chart.canvas.offsetTop;
      var positionX = this._chart.canvas.offsetLeft;

      $('.chartjs-tooltip').css({
        opacity: 0,
      });

      if (!tooltip || !tooltip.opacity) {
        return;
      }

      /* keep track of y-positions so we know before we load two tooltips to the same location */
      var occupied_y_positions = [];
      for (var i = 0; i < tooltip.dataPoints.length; i++) {
        var dataPoint = tooltip.dataPoints[i];
        var name = datasets[dataPoint.datasetIndex].label;

        //var content = name + ' @ ' + [ethBlockNumberToDateStr(dataPoint.xLabel), toReadableHashrate(dataPoint.yLabel)].join(': ');
        var html_dot = '<span style="color:' + tooltip.labelColors[i].borderColor + ';">&bull;</span>';
        var content = html_dot + ' ' + name + ': ' + toReadableHashrate(dataPoint.yLabel);
        var $tooltip = $('#tooltip-' + dataPoint.datasetIndex);

        var y_position = positionY + dataPoint.y;
        while (occupied_y_positions.includes(y_position)) {
          y_position += y_position_offset;
        }
        occupied_y_positions.push(y_position);

        $tooltip.html(content);
        $tooltip.css({
          opacity: 1,
          top: y_position + 'px',
          left: positionX + dataPoint.x + 'px',
        });
      }
    };

  /* Note: when changing color scheme we will need to modify this as well */
  //Chart.defaults.global.defaultFontColor = '#f2f2f2';

  /* hashrate and difficulty chart */
  var hr_diff_chart = new Chart.Scatter(document.getElementById('chart-hashrate-difficulty').getContext('2d'), {
    type: 'line',

    data: {
        datasets: datasets,
    },

    options: {
      legend: {
        position: 'right',
      },

      tooltips: {
        enabled: false,
        mode: 'index',
        intersect: false,
        custom: customTooltips,
      },
      scales: {
        xAxes: [{
          gridLines: {
            color: 'rgb(97, 97, 97)',
            zeroLineColor: 'rgb(97, 97, 97)',
          },
          ticks: {
            callback: function(value, index, values) {
              return ethBlockNumberToDateStr(value);
            },
            //stepSize: 6*((24*60*60)/15),  // 6 days
          }
        }],
        yAxes: [{
          id: 'first-y-axis',
          position: 'left',
          type: 'linear',
          //type: 'logarithmic',  /* hard to read */
          scaleLabel: {
            display: true,
            labelString: 'Network Hashrate',
            //fontColor: 'rgb(156, 204, 101)',
          },
          gridLines: {
            // color: 'rgb(97, 97, 97)',
            // zeroLineColor: 'rgb(97, 97, 97)',
          },
          ticks: {
            // Include a dollar sign in the ticks
            callback: function(value, index, values) {
              return toReadableHashrate(value);
            },
            //maxTicksLimit: 6,
            autoSkip: true,
            /*stepSize: 1000,*/
          }
        }]
      }
    },
    });
}



function generateDifficultyGraphData(eth, target_cv_obj, era_cv_obj) {
  el('#hashrates').innerHTML = '<canvas id="chart-hashrate-difficulty" width="4rem" height="2rem"></canvas>';
  var target_values = target_cv_obj.getValues;
  var era_values = era_cv_obj.getValues;

  function convertValuesToChartData(values, value_mod_function) {
    var chart_data = []
    for (var i = 0; i < values.length; i++) {
      /* TODO: remove this if we expect some values to be zero */
      if(values[i][1].eq(_ZERO_BN)) {
        continue;
      }
      if(value_mod_function == undefined) {
        value_mod_function = function(v){return v};
      }
      chart_data.push({
        x: values[i][0],
        y: value_mod_function(values[i][1]),
      })
      //console.log('log', values[i][0], value_mod_function(values[i][1]))
      //labels.push(values[i][0]);
      //chart_data.push(_MAXIMUM_TARGET_BN.div(values[i][1]));
    }
    return chart_data;
  }

  function getErasPerBlockFromEraData(era_values) {
    var chart_data = []
    for (var step = 1; step < era_values.length; step++) {

      var eth_blocks_passed = era_values[step][0] - era_values[step-1][0];
      var eras_passed = era_values[step][1] - era_values[step-1][1];

      if (eth_blocks_passed == 0) {
        continue;
      }

      var eras_per_eth_block = eras_passed / eth_blocks_passed;

      chart_data.push({
        x: era_values[step][0],
        y: eras_per_eth_block,
      })
      //console.log('log', era_values[step][0], value_mod_function(era_values[step][1]))
      //labels.push(era_values[step][0]);
      //chart_data.push(_MAXIMUM_TARGET_BN.div(values[step][1]));
    }
    return chart_data;
  }

  function getHashrateDataFromDifficultyAndErasPerBlockData(difficulty_data, eras_per_block_data) {
    var expected_eras_per_block = 1/60; /* should be 60 times slower than ethereum */
    var difficulty_data_index = 0;
    var difficulty_change_block_num = 0;
    var chart_data = []
    for (var step = 0; step < eras_per_block_data.length; step++) {
      var current_eth_block = eras_per_block_data[step].x;
      var current_eras_per_block = eras_per_block_data[step].y;

      while(difficulty_data_index < difficulty_data.length - 1
            && difficulty_data[difficulty_data_index+1].x < current_eth_block) {
        difficulty_change_block_num = difficulty_data[difficulty_data_index+1].x;
        difficulty_data_index += 1;
      }

      //console.log('diff chg @', difficulty_change_block_num);

      var difficulty = difficulty_data[difficulty_data_index].y.toNumber();

      /* if difficulty change occurs within this step window */
      if (step != 0
          && difficulty_data_index != 0
          && eras_per_block_data[step].x > difficulty_change_block_num
          && eras_per_block_data[step-1].x < difficulty_change_block_num) {

        /* make a new half-way difficulty that takes the duration of each 
           seperate difficulty into accout  */

        var step_size_in_eth_blocks = eras_per_block_data[step].x - eras_per_block_data[step-1].x;
        var diff1_duration = eras_per_block_data[step].x - difficulty_change_block_num;
        var diff2_duration = difficulty_change_block_num - eras_per_block_data[step-1].x;

        var current_difficulty = difficulty_data[difficulty_data_index].y.toNumber();
        /* NOTE: since the data is stored kind-of oddly (two values per
           difficulty: both the first and last known block at that value), we
           index difficulty_data as step-1 instead of step-2, skipping a
           value. */
        var last_difficulty = difficulty_data[difficulty_data_index-1].y.toNumber();

        // console.log('step size', step_size_in_eth_blocks);
        // console.log('dif', difficulty);
        // console.log('d curr', eras_per_block_data[step].x, diff1_duration, current_difficulty);
        // console.log('d  old', eras_per_block_data[step-1].x, diff2_duration, last_difficulty);

        difficulty = (current_difficulty * (diff1_duration/step_size_in_eth_blocks))
                     + (last_difficulty * (diff2_duration/step_size_in_eth_blocks));
        //console.log('d', difficulty);


      }

      var unadjusted_network_hashrate = difficulty * 2**22 / 600;

      var network_hashrate = unadjusted_network_hashrate * (current_eras_per_block/expected_eras_per_block);

      console.log('for block', current_eth_block, 'diff', difficulty.toString(), 'uhr', unadjusted_network_hashrate, 'hr', network_hashrate)

      chart_data.push({
        x: current_eth_block,
        y: network_hashrate,
      })
    }
    return chart_data;
  }

  var difficulty_data = convertValuesToChartData(target_values, 
                                                 (x)=>{return _MAXIMUM_TARGET_BN.div(x)});
  var era_data = convertValuesToChartData(era_values);

  var eras_per_block_data = getErasPerBlockFromEraData(era_values);

  var hashrate_data = getHashrateDataFromDifficultyAndErasPerBlockData(difficulty_data, eras_per_block_data);

  var all_chart_data = [];


  return hashrate_data;
}

async function refine_mining_target_values(mining_target_values){
  for (var i = 0; i < 6; i++) {
    log('increasing resolution..', i+1, '/ 6');
    await mining_target_values.waitUntilLoaded();
    mining_target_values.increaseTransitionResolution();
    /* veen though there are only 6 steps, divide by 7 so the last % shown isn't 100% (kindof misleading) */
    el('#hashrates').innerHTML = '<div class="">Loading info from the blockchain... <span style="font-weight:600;">' + (100*(i+1)/7).toFixed(0) + '%</span></div>';
  }

  await mining_target_values.waitUntilLoaded();

  log('deduplicating..');
  mining_target_values.deduplicate();
  mining_target_values.removeExtraValuesForStepChart();
}


async function updateDifficultyGraph(eth, num_days){
  /*
  note: this is implementation of diff. in contract:
      function getMiningDifficulty() public constant returns (uint) 
        return _MAXIMUM_TARGET.div(miningTarget);
  */
  var contract_address = '0xB6eD7644C69416d67B522e20bC294A9a9B405B31';
  var max_blocks = num_days*24*60*(60/15);
  var initial_search_points = num_days*2; /* in some crazy world where readjustments happen every day, this will catch all changes */

  //var current_eth_block = getValueFromStats('Last Eth Block', stats);
  var current_eth_block = parseInt((await eth.blockNumber()).toString(10), 10);

  // 'reward era' is at location 7
  var era_values = new contractValueOverTime(eth, contract_address, '7');
  era_values.addValuesInRange((current_eth_block-max_blocks), current_eth_block, initial_search_points);

  // 'mining target' is at location 11
  var mining_target_values = new contractValueOverTime(eth, contract_address, '11');
  mining_target_values.addValuesInRange((current_eth_block-max_blocks), current_eth_block, initial_search_points);
  await refine_mining_target_values(mining_target_values);
  
  /* Note: we sort these down here because we need to wait until values are
     loaded before sorting. technically we should explicitly wait, but these
     should finish long before refining the mining targets */
  era_values.sortValues();
  era_values.printValuesToLog();

  var hashrate_data = generateDifficultyGraphData(eth, mining_target_values, era_values);


  var shittokens = [
    'EOS',
    'Tronix',
    //'VeChain Token',
    'VeChain',
    'BNB',
    'OMGToken',
    'ICON',
    'Bytom',
    //'Populus Platform',
    'Populus',
    'Digix DAO',
  ];

  var oxbtc_chart_data = 
  {
    name: '0xBitcoin',
    data: hashrate_data,
  };

  var zeroed_hashrate_data = [];
  for (var i = 0; i < hashrate_data.length; i++) {
    zeroed_hashrate_data.push({
      x: hashrate_data[i].x,
      y: 0,
    });
  }

  var all_chart_data = [];

  all_chart_data.push(oxbtc_chart_data);
  for (i in shittokens) {
    all_chart_data.push({
      name: shittokens[i],
      data: zeroed_hashrate_data,
    });
  }

  showDifficultyGraph(all_chart_data);  
}

function updateGraphData() {
  setTimeout(()=>{updateDifficultyGraph(eth, 30)}, 0); /* 30 days */
  updateLastUpdatedTime();
}